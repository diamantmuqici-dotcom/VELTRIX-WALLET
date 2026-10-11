import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import {
  ASSET_MAP,
  ASSETS,
  candleHistory,
  demoPrice,
  demoQuote,
  executeTrade,
  portfolioHistory,
  portfolioSummary,
  priceHistory,
  quoteTrade,
  RANGE_IDS,
} from '../src/domain/markets';
import { balance, ctxAt, expectConsistent, fixture, ok } from './helpers';

const NOW = new Date('2026-03-10T15:00:00Z').getTime();

describe('demo price engine', () => {
  it('is deterministic and positive for every asset', () => {
    for (const a of ASSETS) {
      const p1 = demoPrice(a, NOW);
      const p2 = demoPrice(a, NOW);
      expect(p1).toBe(p2);
      expect(p1).toBeGreaterThan(0);
      expect(Number.isFinite(p1)).toBe(true);
      // stays in a plausible band around the reference level
      expect(p1 / a.base).toBeGreaterThan(0.2);
      expect(p1 / a.base).toBeLessThan(5);
    }
  });

  it('moves continuously (no jumps between adjacent minutes)', () => {
    const a = ASSET_MAP.get('AAPL')!;
    for (let i = 0; i < 200; i++) {
      const t = NOW + i * 60_000;
      const r = demoPrice(a, t + 60_000) / demoPrice(a, t);
      expect(Math.abs(r - 1)).toBeLessThan(0.01);
    }
  });

  it('produces history and candles for every range', () => {
    const a = ASSET_MAP.get('BTC')!;
    for (const r of RANGE_IDS) {
      const h = priceHistory(a, r, NOW);
      expect(h.length).toBeGreaterThan(20);
      expect(h[h.length - 1].t).toBe(NOW);
      for (let i = 1; i < h.length; i++) expect(h[i].t).toBeGreaterThan(h[i - 1].t);
      const c = candleHistory(a, r, NOW, 40);
      for (const k of c) {
        expect(k.h).toBeGreaterThanOrEqual(Math.max(k.o, k.c) - 1e-9);
        expect(k.l).toBeLessThanOrEqual(Math.min(k.o, k.c) + 1e-9);
      }
    }
  });

  it('quotes at the display precision', () => {
    expect(demoQuote(ASSET_MAP.get('EURUSD')!, NOW)).toMatch(/^\d+\.\d{5}$/);
    expect(demoQuote(ASSET_MAP.get('AAPL')!, NOW)).toMatch(/^\d+\.\d{2}$/);
  });
});

describe('simulated trading', () => {
  it('buys with a hypothetical fee and tracks the average cost including fees', () => {
    const { state, ctx } = fixture();
    const q = quoteTrade(state, { symbol: 'AAPL', side: 'buy', price: '200.00', notional: 100_000 });
    expect('error' in q).toBe(false);
    if ('error' in q) return;
    expect(q.quantity).toBe('5');
    expect(q.notional).toBe(100_000);
    expect(q.fee).toBe(100); // 0.10 % (min $1.00)
    expect(q.total).toBe(100_100);
    const r = ok(executeTrade(state, { symbol: 'AAPL', side: 'buy', price: '200.00', notional: 100_000 }, ctx));
    expect(balance(r.state, 'acc_invest')).toBe(1_000_000 - 100_100);
    expect(r.state.markets.positions.AAPL.avgCost).toBe('200.2');
    // second buy at a higher price averages up
    const r2 = ok(executeTrade(r.state, { symbol: 'AAPL', side: 'buy', price: '250.00', quantity: '5' }, ctx));
    const avg = new Big(r2.state.markets.positions.AAPL.avgCost);
    expect(avg.toFixed(4)).toBe(new Big(100_100 + 125_125).div(100).div(10).toFixed(4));
    expect(r2.state.markets.positions.AAPL.quantity).toBe('10');
    expectConsistent(r2.state);
  });

  it('sells against the average cost and books realized P&L', () => {
    const { state, ctx } = fixture();
    const b = ok(executeTrade(state, { symbol: 'AAPL', side: 'buy', price: '200.00', quantity: '10' }, ctx));
    const s = ok(executeTrade(b.state, { symbol: 'AAPL', side: 'sell', price: '220.00', quantity: '4' }, ctx));
    // proceeds 880.00, fee 1.00 (min), cost basis 4 × 200.20 = 800.80 → +78.20
    expect(s.order.realizedPnl).toBe(7_820);
    expect(s.state.markets.realizedPnl).toBe(7_820);
    expect(s.state.markets.positions.AAPL.quantity).toBe('6');
    const all = ok(executeTrade(s.state, { symbol: 'AAPL', side: 'sell', price: '190.00', quantity: '6' }, ctx));
    expect(all.state.markets.positions.AAPL).toBeUndefined();
    expect(all.state.markets.orders.length).toBe(3);
    expectConsistent(all.state);
  });

  it('rejects invalid trades', () => {
    const { state, ctx } = fixture();
    expect(executeTrade(state, { symbol: 'AAPL', side: 'sell', price: '200', quantity: '1' }, ctx)).toMatchObject({ ok: false, error: 'insufficient_position' });
    expect(executeTrade(state, { symbol: 'AAPL', side: 'buy', price: '200', notional: 2_000_000 }, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    expect(executeTrade(state, { symbol: 'AAPL', side: 'buy', price: '0', notional: 100 }, ctx)).toMatchObject({ ok: false, error: 'invalid_price' });
    expect(executeTrade(state, { symbol: 'AAPL', side: 'buy', price: 'NaN', notional: 100 }, ctx)).toMatchObject({ ok: false, error: 'invalid_price' });
    expect(executeTrade(state, { symbol: 'NOPE', side: 'buy', price: '1', notional: 100 }, ctx)).toMatchObject({ ok: false, error: 'unknown_asset' });
    expect(executeTrade(state, { symbol: 'USDJPY', side: 'buy', price: '150', notional: 100 }, ctx)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(executeTrade(state, { symbol: 'BTC', side: 'buy', price: '100000', notional: 1 }, ctx)).toMatchObject({ ok: false, error: 'amount_too_small' });
    const off = { ...state, markets: { ...state.markets, demoEnabled: false } };
    expect(executeTrade(off, { symbol: 'AAPL', side: 'buy', price: '200', notional: 100 }, ctx)).toMatchObject({ ok: false, error: 'markets_disabled' });
  });

  it('is idempotent per order key', () => {
    const { state, ctx } = fixture();
    const a = ok(executeTrade(state, { symbol: 'BTC', side: 'buy', price: '100000', notional: 50_000, opKey: 'o1' }, ctx));
    const b = ok(executeTrade(a.state, { symbol: 'BTC', side: 'buy', price: '100000', notional: 50_000, opKey: 'o1' }, ctx));
    expect(b.duplicate).toBe(true);
    expect(b.state.markets.orders.length).toBe(1);
  });

  it('values the portfolio with unrealized P&L and reconstructs its history', () => {
    const { state } = fixture();
    const t0 = new Date(NOW - 20 * 86_400_000);
    const asset = ASSET_MAP.get('US500')!;
    const price = demoQuote(asset, t0.getTime());
    const b = ok(executeTrade(state, { symbol: 'US500', side: 'buy', price, notional: 500_000 }, ctxAt(t0)));
    const p = portfolioSummary(b.state, NOW);
    expect(p.positions.length).toBe(1);
    expect(p.total).toBe(p.cash + p.holdings);
    expect(p.unrealized).toBe(p.positions[0].value - p.positions[0].costBasis);
    const h = portfolioHistory(b.state, '1M', NOW);
    expect(h.length).toBeGreaterThan(10);
    expect(h[h.length - 1].p).toBe(p.total);
  });
});
