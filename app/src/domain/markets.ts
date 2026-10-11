import Big from 'big.js';
import { findProcessedOp, postTxn, pushNotification, recordOp, txnEffects } from './ledger';
import { computeFee } from './money';
import { fail, money, newTxn } from './ops/common';
import type { Account, AppState, OpContext, OpError, OpResult, Order, Position, Txn } from './types';

/**
 * Market simulator.
 *
 * Prices come from a deterministic, clearly labelled DEMO price engine — a
 * mean-reverting random walk seeded per symbol. Nothing here is market data.
 * Trades settle against the investment account (USD) through the ledger.
 */

export type AssetKind = 'fx' | 'index' | 'stock' | 'metal' | 'crypto';

export interface AssetDef {
  symbol: string;
  display: string;
  name: string;
  kind: AssetKind;
  /** reference price (USD or pair quote) */
  base: number;
  /** annualised volatility */
  vol: number;
  /** annual drift of the reference level */
  growth: number;
  priceDp: number;
  qtyDp: number;
  unit: string;
  /** Only USD-settled instruments can be traded in the simulator. */
  tradable: boolean;
}

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  fx: 'Currency pairs',
  index: 'Indices',
  stock: 'Stocks',
  metal: 'Metals',
  crypto: 'Crypto',
};

export const ASSETS: AssetDef[] = [
  // Major currency pairs (XXX/USD pairs are tradable; others are watch-only)
  { symbol: 'EURUSD', display: 'EUR/USD', name: 'Euro / US Dollar', kind: 'fx', base: 1.165, vol: 0.07, growth: 0, priceDp: 5, qtyDp: 0, unit: 'EUR', tradable: true },
  { symbol: 'GBPUSD', display: 'GBP/USD', name: 'British Pound / US Dollar', kind: 'fx', base: 1.345, vol: 0.08, growth: 0, priceDp: 5, qtyDp: 0, unit: 'GBP', tradable: true },
  { symbol: 'AUDUSD', display: 'AUD/USD', name: 'Australian Dollar / US Dollar', kind: 'fx', base: 0.655, vol: 0.09, growth: 0, priceDp: 5, qtyDp: 0, unit: 'AUD', tradable: true },
  { symbol: 'USDJPY', display: 'USD/JPY', name: 'US Dollar / Japanese Yen', kind: 'fx', base: 147.5, vol: 0.09, growth: 0, priceDp: 3, qtyDp: 0, unit: 'USD', tradable: false },
  { symbol: 'USDCHF', display: 'USD/CHF', name: 'US Dollar / Swiss Franc', kind: 'fx', base: 0.805, vol: 0.08, growth: 0, priceDp: 5, qtyDp: 0, unit: 'USD', tradable: false },
  { symbol: 'USDCAD', display: 'USD/CAD', name: 'US Dollar / Canadian Dollar', kind: 'fx', base: 1.38, vol: 0.06, growth: 0, priceDp: 5, qtyDp: 0, unit: 'USD', tradable: false },
  { symbol: 'EURGBP', display: 'EUR/GBP', name: 'Euro / British Pound', kind: 'fx', base: 0.866, vol: 0.06, growth: 0, priceDp: 5, qtyDp: 0, unit: 'EUR', tradable: false },
  { symbol: 'USDTRY', display: 'USD/TRY', name: 'US Dollar / Turkish Lira', kind: 'fx', base: 41.2, vol: 0.12, growth: 0.25, priceDp: 4, qtyDp: 0, unit: 'USD', tradable: false },
  // Broad-market indices (generic names, demo trackers priced in USD)
  { symbol: 'US500', display: 'US500', name: 'US Large Cap 500 Index', kind: 'index', base: 6450, vol: 0.17, growth: 0.07, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  { symbol: 'US100', display: 'US100', name: 'US Tech 100 Index', kind: 'index', base: 23400, vol: 0.22, growth: 0.09, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  { symbol: 'US30', display: 'US30', name: 'US Industrial 30 Index', kind: 'index', base: 45200, vol: 0.15, growth: 0.05, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  { symbol: 'DE40', display: 'DE40', name: 'Germany 40 Index', kind: 'index', base: 24100, vol: 0.18, growth: 0.05, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  { symbol: 'UK100', display: 'UK100', name: 'UK 100 Index', kind: 'index', base: 9150, vol: 0.14, growth: 0.04, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  { symbol: 'JP225', display: 'JP225', name: 'Japan 225 Index', kind: 'index', base: 42500, vol: 0.2, growth: 0.05, priceDp: 2, qtyDp: 3, unit: 'units', tradable: true },
  // Popular stocks (sample prices only)
  { symbol: 'AAPL', display: 'AAPL', name: 'Apple Inc.', kind: 'stock', base: 232, vol: 0.28, growth: 0.08, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'MSFT', display: 'MSFT', name: 'Microsoft Corp.', kind: 'stock', base: 505, vol: 0.25, growth: 0.1, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'NVDA', display: 'NVDA', name: 'NVIDIA Corp.', kind: 'stock', base: 178, vol: 0.5, growth: 0.18, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'TSLA', display: 'TSLA', name: 'Tesla Inc.', kind: 'stock', base: 335, vol: 0.6, growth: 0.06, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'AMZN', display: 'AMZN', name: 'Amazon.com Inc.', kind: 'stock', base: 228, vol: 0.32, growth: 0.1, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'GOOGL', display: 'GOOGL', name: 'Alphabet Inc. Class A', kind: 'stock', base: 205, vol: 0.3, growth: 0.09, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'META', display: 'META', name: 'Meta Platforms Inc.', kind: 'stock', base: 745, vol: 0.38, growth: 0.1, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  { symbol: 'NFLX', display: 'NFLX', name: 'Netflix Inc.', kind: 'stock', base: 1210, vol: 0.35, growth: 0.1, priceDp: 2, qtyDp: 4, unit: 'shares', tradable: true },
  // Metals
  { symbol: 'XAUUSD', display: 'XAU/USD', name: 'Gold spot', kind: 'metal', base: 3350, vol: 0.15, growth: 0.08, priceDp: 2, qtyDp: 3, unit: 'oz', tradable: true },
  { symbol: 'XAGUSD', display: 'XAG/USD', name: 'Silver spot', kind: 'metal', base: 38.2, vol: 0.28, growth: 0.06, priceDp: 3, qtyDp: 2, unit: 'oz', tradable: true },
  // Crypto
  { symbol: 'BTC', display: 'BTC', name: 'Bitcoin', kind: 'crypto', base: 112000, vol: 0.55, growth: 0.15, priceDp: 2, qtyDp: 6, unit: 'BTC', tradable: true },
  { symbol: 'ETH', display: 'ETH', name: 'Ethereum', kind: 'crypto', base: 4300, vol: 0.7, growth: 0.15, priceDp: 2, qtyDp: 5, unit: 'ETH', tradable: true },
  { symbol: 'SOL', display: 'SOL', name: 'Solana', kind: 'crypto', base: 190, vol: 0.85, growth: 0.12, priceDp: 2, qtyDp: 4, unit: 'SOL', tradable: true },
  { symbol: 'XRP', display: 'XRP', name: 'XRP', kind: 'crypto', base: 2.95, vol: 0.85, growth: 0.08, priceDp: 4, qtyDp: 2, unit: 'XRP', tradable: true },
  { symbol: 'ADA', display: 'ADA', name: 'Cardano', kind: 'crypto', base: 0.86, vol: 0.85, growth: 0.06, priceDp: 4, qtyDp: 2, unit: 'ADA', tradable: true },
];

export const ASSET_MAP: Map<string, AssetDef> = new Map(ASSETS.map((a) => [a.symbol, a]));

export const DEFAULT_WATCHLIST = ['US500', 'AAPL', 'NVDA', 'EURUSD', 'XAUUSD', 'BTC'];

/* ------------------------------------------------------------------ */
/* Deterministic demo price engine                                     */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
const EPOCH = Date.UTC(2022, 0, 3);
const REF_DAY = Math.floor((Date.UTC(2026, 0, 1) - EPOCH) / DAY);
const STEPS = 288; // 5-minute steps per day
const THETA = 0.012;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix32(a: number): number {
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  a ^= a >>> 16;
  return a >>> 0;
}

function uniform(seed: number, i: number, j: number): number {
  const h = mix32(seed ^ mix32(Math.imul(i | 0, 0x9e3779b1) + 0x632be5ab) ^ mix32(Math.imul(j | 0, 0x85ebca77) + 0x27d4eb2f));
  return (h + 0.5) / 4294967296;
}

function gauss(seed: number, i: number, j: number): number {
  const u1 = uniform(seed, i, j * 2);
  const u2 = uniform(seed, i, j * 2 + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface PathCache {
  seed: number;
  sigma: number;
  logs: Float64Array;
}

const paths = new Map<string, PathCache>();
const intradayCache = new Map<string, Float64Array>();
const INTRADAY_KEEP = 400;

function dayIndex(t: number): number {
  return Math.floor((t - EPOCH) / DAY);
}

function ensurePath(asset: AssetDef, upTo: number): PathCache {
  let p = paths.get(asset.symbol);
  if (p && p.logs.length > upTo) return p;
  const target = Math.max(upTo + 32, dayIndex(Date.now()) + 32);
  const seed = fnv1a(asset.symbol);
  const sigma = asset.vol / Math.sqrt(365);
  const logs = new Float64Array(target + 1);
  const lnBase = Math.log(asset.base);
  logs[0] = lnBase + (asset.growth * (0 - REF_DAY)) / 365;
  for (let d = 1; d <= target; d++) {
    const mu = lnBase + (asset.growth * (d - REF_DAY)) / 365;
    logs[d] = logs[d - 1] + THETA * (mu - logs[d - 1]) + sigma * gauss(seed, d, 0);
  }
  p = { seed, sigma, logs };
  paths.set(asset.symbol, p);
  return p;
}

function dailyLog(asset: AssetDef, d: number): number {
  if (d < 0) d = 0;
  return ensurePath(asset, d).logs[d];
}

function intraday(asset: AssetDef, d: number): Float64Array {
  const key = `${asset.symbol}|${d}`;
  const hit = intradayCache.get(key);
  if (hit) return hit;
  const p = ensurePath(asset, d);
  const x0 = dailyLog(asset, d - 1);
  const x1 = dailyLog(asset, d);
  const s = p.sigma / Math.sqrt(STEPS);
  const w = new Float64Array(STEPS + 1);
  for (let k = 1; k <= STEPS; k++) w[k] = w[k - 1] + s * gauss(p.seed, d, k + 1000);
  const out = new Float64Array(STEPS + 1);
  for (let k = 0; k <= STEPS; k++) {
    const f = k / STEPS;
    out[k] = x0 + (x1 - x0) * f + (w[k] - f * w[STEPS]);
  }
  if (intradayCache.size > INTRADAY_KEEP) {
    const first = intradayCache.keys().next().value;
    if (first !== undefined) intradayCache.delete(first);
  }
  intradayCache.set(key, out);
  return out;
}

/** Demo price of an asset at time t (ms). Deterministic for a given t. */
export function demoPrice(asset: AssetDef, t: number): number {
  const rel = t - EPOCH;
  const d = Math.floor(rel / DAY);
  const pos = ((rel - d * DAY) / DAY) * STEPS;
  const k = Math.min(STEPS - 1, Math.floor(pos));
  const f = pos - k;
  const arr = intraday(asset, d);
  let x = arr[k] + (arr[k + 1] - arr[k]) * f;
  const p = ensurePath(asset, d);
  x += (p.sigma / Math.sqrt(STEPS)) * 0.12 * gauss(p.seed, Math.floor(t / 3000), 7);
  return Math.exp(x);
}

/** Price rounded to the asset's display precision, as a decimal string (the "displayed sample quote"). */
export function demoQuote(asset: AssetDef, t: number): string {
  return new Big(demoPrice(asset, t)).round(asset.priceDp, Big.roundHalfUp).toFixed(asset.priceDp);
}

export function change24h(asset: AssetDef, now: number): number {
  const a = demoPrice(asset, now - DAY);
  const b = demoPrice(asset, now);
  return ((b - a) / a) * 100;
}

export type RangeId = '1D' | '1W' | '1M' | '3M' | '1Y' | '5Y';
export const RANGE_IDS: RangeId[] = ['1D', '1W', '1M', '3M', '1Y', '5Y'];
export const RANGES: Record<RangeId, { span: number; step: number }> = {
  '1D': { span: DAY, step: 5 * 60_000 },
  '1W': { span: 7 * DAY, step: 3_600_000 },
  '1M': { span: 30 * DAY, step: 4 * 3_600_000 },
  '3M': { span: 91 * DAY, step: DAY },
  '1Y': { span: 365 * DAY, step: DAY },
  '5Y': { span: 5 * 365 * DAY, step: 7 * DAY },
};

export interface PricePoint {
  t: number;
  p: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function priceAtCoarse(asset: AssetDef, t: number, step: number, now: number): number {
  if (step < DAY || now - t < DAY) return demoPrice(asset, t);
  return Math.exp(dailyLog(asset, dayIndex(t)));
}

export function priceHistory(asset: AssetDef, range: RangeId, now: number): PricePoint[] {
  const { span, step } = RANGES[range];
  const n = Math.floor(span / step);
  const pts: PricePoint[] = [];
  for (let i = n; i >= 0; i--) {
    const t = now - i * step;
    pts.push({ t, p: priceAtCoarse(asset, t, step, now) });
  }
  return pts;
}

export function candleHistory(asset: AssetDef, range: RangeId, now: number, maxCandles = 60): Candle[] {
  const { span } = RANGES[range];
  const bucket = Math.max(RANGES[range].step, span / maxCandles);
  const n = Math.floor(span / bucket);
  const p = ensurePath(asset, dayIndex(now));
  const out: Candle[] = [];
  for (let i = n; i >= 1; i--) {
    const t0 = now - i * bucket;
    const t1 = now - (i - 1) * bucket;
    const o = priceAtCoarse(asset, t0, bucket, now);
    const c = i === 1 ? demoPrice(asset, now) : priceAtCoarse(asset, t1, bucket, now);
    let h = Math.max(o, c);
    let l = Math.min(o, c);
    if (bucket < DAY) {
      for (let s = 1; s <= 3; s++) {
        const v = demoPrice(asset, t0 + (bucket * s) / 4);
        h = Math.max(h, v);
        l = Math.min(l, v);
      }
    } else {
      const bi = Math.floor(t0 / bucket);
      h *= Math.exp(Math.abs(gauss(p.seed, bi, 11)) * p.sigma * Math.sqrt(bucket / DAY) * 0.45);
      l *= Math.exp(-Math.abs(gauss(p.seed, bi, 12)) * p.sigma * Math.sqrt(bucket / DAY) * 0.45);
    }
    out.push({ t: t0, o, h, l, c });
  }
  return out;
}

export interface AssetStats {
  price: number;
  change: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
}

export function assetStats(asset: AssetDef, now: number): AssetStats {
  const day = priceHistory(asset, '1D', now);
  const year = priceHistory(asset, '1Y', now);
  return {
    price: demoPrice(asset, now),
    change: change24h(asset, now),
    dayHigh: Math.max(...day.map((x) => x.p)),
    dayLow: Math.min(...day.map((x) => x.p)),
    yearHigh: Math.max(...year.map((x) => x.p)),
    yearLow: Math.min(...year.map((x) => x.p)),
  };
}

/* ------------------------------------------------------------------ */
/* Simulated trading                                                   */
/* ------------------------------------------------------------------ */

export function investmentAccount(state: AppState): Account | undefined {
  return state.accounts.find((a) => a.kind === 'investment' && !a.archived);
}

export interface TradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  /** displayed sample quote as decimal string */
  price: string;
  /** USD minor units to spend (buy) or receive (sell) */
  notional?: number;
  /** explicit quantity (decimal string) */
  quantity?: string;
}

export interface TradeQuote {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  notional: number;
  fee: number;
  /** buy: cash debited (notional + fee); sell: cash credited (notional − fee) */
  total: number;
  realizedPnl?: number;
  avgCostAfter?: string;
}

function toCents(b: Big): number {
  return Number(b.times(100).round(0, Big.roundHalfUp).toString());
}

export function parsePrice(price: unknown): Big | null {
  if (typeof price !== 'string' && typeof price !== 'number') return null;
  if (typeof price === 'number' && !Number.isFinite(price)) return null;
  try {
    const b = new Big(price);
    return b.gt(0) ? b : null;
  } catch {
    return null;
  }
}

export function quoteTrade(state: AppState, req: TradeRequest): TradeQuote | { error: OpError } {
  if (!state.markets.demoEnabled) return { error: 'markets_disabled' };
  const asset = ASSET_MAP.get(req.symbol);
  if (!asset) return { error: 'unknown_asset' };
  if (!asset.tradable) return { error: 'invalid_input' };
  const price = parsePrice(req.price);
  if (!price) return { error: 'invalid_price' };
  let qty: Big;
  try {
    if (req.quantity !== undefined && req.quantity !== '') qty = new Big(req.quantity).round(asset.qtyDp, Big.roundDown);
    else if (req.notional !== undefined && Number.isSafeInteger(req.notional) && req.notional > 0)
      qty = new Big(req.notional).div(100).div(price).round(asset.qtyDp, Big.roundDown);
    else return { error: 'missing_amount' };
  } catch {
    return { error: 'invalid_amount' };
  }
  if (qty.lte(0)) return { error: 'amount_too_small' };
  const notional = toCents(qty.times(price));
  if (notional <= 0) return { error: 'amount_too_small' };
  const fee = computeFee(notional, state.settings.fees.trade);
  const pos = state.markets.positions[req.symbol];
  if (req.side === 'buy') {
    const oldQty = new Big(pos?.quantity ?? '0');
    const oldAvg = new Big(pos?.avgCost ?? '0');
    const newQty = oldQty.plus(qty);
    const avgCostAfter = oldQty.times(oldAvg).plus(new Big(notional + fee).div(100)).div(newQty).round(8, Big.roundHalfUp).toString();
    return { symbol: req.symbol, side: 'buy', quantity: qty.toString(), price: price.toString(), notional, fee, total: notional + fee, avgCostAfter };
  }
  if (!pos || new Big(pos.quantity).lt(qty)) return { error: 'insufficient_position' };
  const total = notional - fee;
  if (total <= 0) return { error: 'amount_too_small' };
  const costBasis = toCents(qty.times(new Big(pos.avgCost)));
  return { symbol: req.symbol, side: 'sell', quantity: qty.toString(), price: price.toString(), notional, fee, total, realizedPnl: total - costBasis, avgCostAfter: pos.avgCost };
}

export function executeTrade(state: AppState, req: TradeRequest & { opKey?: string }, ctx: OpContext): OpResult<{ order: Order; txn: Txn }> {
  const dupId = findProcessedOp(state, req.opKey);
  if (dupId) {
    const order = state.markets.orders.find((o) => o.id === dupId);
    const txn = order ? state.transactions.find((t) => t.id === order.txnId) : undefined;
    if (order && txn) return { ok: true, state, duplicate: true, order, txn };
  }
  const acc = investmentAccount(state);
  if (!acc) return fail('account_not_found', 'Create an investment account first.');
  if (acc.currency !== 'USD') return fail('currency_mismatch');
  const q = quoteTrade(state, req);
  if ('error' in q) return fail(q.error);
  if (q.side === 'buy' && acc.balance < q.total) return fail('insufficient_funds');
  const asset = ASSET_MAP.get(q.symbol) as AssetDef;
  const orderId = ctx.id('ord');
  const txn = newTxn(ctx, {
    type: q.side === 'buy' ? 'invest_buy' : 'invest_sell',
    title: `${q.side === 'buy' ? 'Bought' : 'Sold'} ${asset.display}`,
    amount: q.notional,
    fee: q.fee,
    currency: 'USD',
    direction: q.side === 'buy' ? 'out' : 'in',
    accountId: acc.id,
    category: 'investing',
    applied: true,
    trade: { orderId, symbol: q.symbol, side: q.side, quantity: q.quantity, price: q.price, realizedPnl: q.realizedPnl },
  });
  const order: Order = {
    id: orderId,
    symbol: q.symbol,
    side: q.side,
    quantity: q.quantity,
    price: q.price,
    notional: q.notional,
    fee: q.fee,
    total: q.total,
    realizedPnl: q.realizedPnl,
    createdAt: ctx.now.toISOString(),
    txnId: txn.id,
  };
  const positions = { ...state.markets.positions };
  const prev = positions[q.symbol];
  if (q.side === 'buy') {
    const newQty = new Big(prev?.quantity ?? '0').plus(q.quantity);
    positions[q.symbol] = {
      symbol: q.symbol,
      quantity: newQty.toString(),
      avgCost: q.avgCostAfter as string,
      openedAt: prev?.openedAt ?? ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    } satisfies Position;
  } else if (prev) {
    const left = new Big(prev.quantity).minus(q.quantity);
    if (left.lte(0)) delete positions[q.symbol];
    else positions[q.symbol] = { ...prev, quantity: left.toString(), updatedAt: ctx.now.toISOString() };
  }
  let next = postTxn(state, txn);
  next = {
    ...next,
    markets: {
      ...next.markets,
      positions,
      orders: [order, ...next.markets.orders],
      realizedPnl: next.markets.realizedPnl + (q.realizedPnl ?? 0),
    },
  };
  next = recordOp(next, req.opKey, orderId);
  next = pushNotification(
    next,
    ctx,
    'market',
    'Simulated order filled',
    `${q.side === 'buy' ? 'Bought' : 'Sold'} ${q.quantity} ${asset.unit === 'shares' || asset.unit === 'units' ? asset.display : asset.unit} at a demo price of ${money(state, toCents(new Big(q.price)), 'USD')}`,
    { screen: 'orders' },
  );
  return { ok: true, state: next, order, txn: next.transactions[next.transactions.length - 1] };
}

/* ------------------------------------------------------------------ */
/* Portfolio maths                                                     */
/* ------------------------------------------------------------------ */

export interface PositionView {
  symbol: string;
  asset: AssetDef;
  quantity: string;
  avgCost: string;
  price: number;
  value: number;
  costBasis: number;
  unrealized: number;
  unrealizedPct: number;
  dayChange: number;
}

export interface PortfolioSummary {
  cash: number;
  holdings: number;
  total: number;
  unrealized: number;
  realized: number;
  dayChange: number;
  dayChangePct: number;
  positions: PositionView[];
}

export function portfolioSummary(state: AppState, now: number): PortfolioSummary {
  const acc = investmentAccount(state);
  const cash = acc?.balance ?? 0;
  const positions: PositionView[] = [];
  let holdings = 0;
  let unrealized = 0;
  let dayChange = 0;
  for (const pos of Object.values(state.markets.positions)) {
    const asset = ASSET_MAP.get(pos.symbol);
    if (!asset) continue;
    const price = demoPrice(asset, now);
    const prev = demoPrice(asset, now - DAY);
    const qty = new Big(pos.quantity);
    const value = toCents(qty.times(price));
    const costBasis = toCents(qty.times(new Big(pos.avgCost)));
    const u = value - costBasis;
    const dc = toCents(qty.times(price - prev));
    holdings += value;
    unrealized += u;
    dayChange += dc;
    positions.push({
      symbol: pos.symbol,
      asset,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      price,
      value,
      costBasis,
      unrealized: u,
      unrealizedPct: costBasis > 0 ? (u / costBasis) * 100 : 0,
      dayChange: dc,
    });
  }
  positions.sort((a, b) => b.value - a.value);
  const total = cash + holdings;
  const base = total - dayChange;
  return { cash, holdings, total, unrealized, realized: state.markets.realizedPnl, dayChange, dayChangePct: base > 0 ? (dayChange / base) * 100 : 0, positions };
}

/** Reconstructs portfolio value over time from the ledger and order history. */
export function portfolioHistory(state: AppState, range: RangeId, now: number): PricePoint[] {
  const acc = investmentAccount(state);
  if (!acc) return [];
  const { span, step } = RANGES[range];
  const n = Math.min(120, Math.floor(span / step));
  const actualStep = span / n;
  const effects = state.transactions
    .flatMap((t) => txnEffects(t).filter((e) => e.accountId === acc.id).map((e) => ({ t: new Date(t.createdAt).getTime(), d: e.delta })))
    .sort((a, b) => a.t - b.t);
  const orders = [...state.markets.orders].map((o) => ({ ...o, t: new Date(o.createdAt).getTime() })).sort((a, b) => a.t - b.t);
  const pts: PricePoint[] = [];
  let ei = 0;
  let oi = 0;
  let cash = 0;
  const qty = new Map<string, Big>();
  for (let i = n; i >= 0; i--) {
    const t = now - i * actualStep;
    while (ei < effects.length && effects[ei].t <= t) cash += effects[ei++].d;
    while (oi < orders.length && orders[oi].t <= t) {
      const o = orders[oi++];
      const cur = qty.get(o.symbol) ?? new Big(0);
      qty.set(o.symbol, o.side === 'buy' ? cur.plus(o.quantity) : cur.minus(o.quantity));
    }
    let value = cash;
    for (const [sym, q] of qty) {
      if (q.lte(0)) continue;
      const asset = ASSET_MAP.get(sym);
      if (asset) value += toCents(q.times(i === 0 ? demoPrice(asset, now) : priceAtCoarse(asset, t, actualStep, now)));
    }
    pts.push({ t, p: value });
  }
  return pts;
}

export function formatQty(qty: string, asset: AssetDef): string {
  const b = new Big(qty);
  const s = b.toFixed(asset.qtyDp).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}
