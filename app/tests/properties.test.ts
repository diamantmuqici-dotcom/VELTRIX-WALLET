import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossRate, DEMO_RATES } from '../src/domain/fx';
import { txnEffects, verifyLedger } from '../src/domain/ledger';
import { ASSET_MAP, demoQuote, executeTrade } from '../src/domain/markets';
import { convertMinor, keypadInput, minorToDecimalString, parseAmount } from '../src/domain/money';
import {
  adjustBalance,
  cancelPending,
  completePending,
  deleteTxn,
  exchange,
  purchase,
  receiveMoney,
  reverseTxn,
  sendMoney,
  transfer,
} from '../src/domain/ops/payments';
import type { AppState, OpContext } from '../src/domain/types';
import { fixture } from './helpers';

const ACCOUNTS = ['acc_main', 'acc_checking', 'acc_savings', 'acc_eur', 'acc_jpy', 'acc_invest', 'acc_credit'];

type Cmd =
  | { k: 'send'; acc: number; amount: number; instant: boolean; pending: boolean }
  | { k: 'receive'; acc: number; amount: number }
  | { k: 'transfer'; from: number; to: number; amount: number }
  | { k: 'exchange'; from: number; to: number; amount: number }
  | { k: 'purchase'; card: number; amount: number }
  | { k: 'adjust'; acc: number; mode: 'add' | 'remove' | 'set'; amount: number }
  | { k: 'reverse'; pick: number }
  | { k: 'delete'; pick: number }
  | { k: 'complete'; pick: number }
  | { k: 'cancel'; pick: number }
  | { k: 'trade'; symbol: number; buy: boolean; notional: number }
  | { k: 'toggleTracking' };

const amount = fc.integer({ min: 1, max: 250_000 });
const idx = fc.integer({ min: 0, max: ACCOUNTS.length - 1 });
const pick = fc.integer({ min: 0, max: 10_000 });
const SYMBOLS = ['AAPL', 'BTC', 'US500', 'EURUSD', 'XAUUSD'];

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ k: fc.constant('send' as const), acc: idx, amount, instant: fc.boolean(), pending: fc.boolean() }),
  fc.record({ k: fc.constant('receive' as const), acc: idx, amount }),
  fc.record({ k: fc.constant('transfer' as const), from: idx, to: idx, amount }),
  fc.record({ k: fc.constant('exchange' as const), from: idx, to: idx, amount }),
  fc.record({ k: fc.constant('purchase' as const), card: fc.integer({ min: 0, max: 1 }), amount }),
  fc.record({ k: fc.constant('adjust' as const), acc: idx, mode: fc.constantFrom('add' as const, 'remove' as const, 'set' as const), amount: fc.integer({ min: 0, max: 300_000 }) }),
  fc.record({ k: fc.constant('reverse' as const), pick }),
  fc.record({ k: fc.constant('delete' as const), pick }),
  fc.record({ k: fc.constant('complete' as const), pick }),
  fc.record({ k: fc.constant('cancel' as const), pick }),
  fc.record({ k: fc.constant('trade' as const), symbol: fc.integer({ min: 0, max: SYMBOLS.length - 1 }), buy: fc.boolean(), notional: fc.integer({ min: 100, max: 500_000 }) }),
  fc.record({ k: fc.constant('toggleTracking' as const) }),
);

function run(s: AppState, c: Cmd, ctx: OpContext): AppState {
  const txnId = (p: number) => (s.transactions.length ? s.transactions[p % s.transactions.length].id : 'none');
  let r: { ok: boolean; state?: AppState };
  switch (c.k) {
    case 'send':
      r = sendMoney(s, { recipient: { name: 'Prop' }, amount: c.amount, accountId: ACCOUNTS[c.acc], instant: c.instant, outcome: c.pending ? 'pending' : 'completed' }, ctx);
      break;
    case 'receive':
      r = receiveMoney(s, { from: { name: 'Prop' }, amount: c.amount, accountId: ACCOUNTS[c.acc] }, ctx);
      break;
    case 'transfer':
      r = transfer(s, { fromId: ACCOUNTS[c.from], toId: ACCOUNTS[c.to], amount: c.amount }, ctx);
      break;
    case 'exchange': {
      const from = s.accounts.find((a) => a.id === ACCOUNTS[c.from])!;
      const to = s.accounts.find((a) => a.id === ACCOUNTS[c.to])!;
      r = exchange(s, { fromId: from.id, toId: to.id, amount: c.amount, rate: crossRate(DEMO_RATES, from.currency, to.currency), rateSource: 'demo', rateTimestamp: DEMO_RATES.publishedAt }, ctx);
      break;
    }
    case 'purchase':
      r = purchase(s, { cardId: s.cards[c.card].id, merchant: 'Prop shop', amount: c.amount, category: 'shopping' }, ctx);
      break;
    case 'adjust':
      r = adjustBalance(s, { accountId: ACCOUNTS[c.acc], mode: c.mode, amount: c.mode === 'set' && ACCOUNTS[c.acc] === 'acc_credit' ? -c.amount : c.amount }, ctx);
      break;
    case 'reverse':
      r = reverseTxn(s, txnId(c.pick), ctx);
      break;
    case 'delete':
      r = deleteTxn(s, txnId(c.pick), ctx);
      break;
    case 'complete':
      r = completePending(s, txnId(c.pick), ctx);
      break;
    case 'cancel':
      r = cancelPending(s, txnId(c.pick), ctx);
      break;
    case 'trade': {
      const symbol = SYMBOLS[c.symbol];
      const price = demoQuote(ASSET_MAP.get(symbol)!, ctx.now.getTime());
      r = executeTrade(s, { symbol, side: c.buy ? 'buy' : 'sell', price, notional: c.notional }, ctx);
      break;
    }
    case 'toggleTracking':
      return { ...s, settings: { ...s.settings, trackBalances: !s.settings.trackBalances } };
  }
  return r.ok && r.state ? r.state : s;
}

describe('ledger invariants under random operation sequences', () => {
  it('balances always equal the sum of applied ledger effects; asset accounts never go negative; credit stays within limit', () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 40 }), (cmds) => {
        let { state: s, ctx } = fixture();
        for (const c of cmds) {
          s = run(s, c, ctx);
          const v = verifyLedger(s);
          if (!v.ok) return false;
          for (const a of s.accounts) {
            if (a.kind === 'credit') {
              if (a.balance > 0 || -a.balance > (a.credit?.limit ?? 0)) return false;
            } else if (a.balance < 0) return false;
            if (!Number.isSafeInteger(a.balance)) return false;
          }
          // Positions never go negative.
          for (const p of Object.values(s.markets.positions)) if (Number(p.quantity) <= 0) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('same-currency transfers conserve the total; fees are the only leakage', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ from: idx, to: idx, amount }), { minLength: 1, maxLength: 25 }), (moves) => {
        let { state: s, ctx } = fixture();
        const total = (st: AppState) => st.accounts.filter((a) => a.currency === 'USD').reduce((x, a) => x + a.balance, 0);
        const before = total(s);
        for (const m of moves) s = run(s, { k: 'transfer', ...m }, ctx);
        return total(s) === before;
      }),
      { numRuns: 200 },
    );
  });

  it('every applied internal entry moves exactly (amount + fee) out and the stated amount in', () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 30 }), (cmds) => {
        let { state: s, ctx } = fixture();
        for (const c of cmds) s = run(s, c, ctx);
        for (const t of s.transactions) {
          const e = txnEffects(t);
          if (!t.applied) {
            if (e.length) return false;
            continue;
          }
          if (t.direction === 'internal') {
            if (e[0].delta !== -(t.amount + t.fee)) return false;
            if (e[1].delta !== (t.fx ? t.fx.targetAmount : t.amount)) return false;
          }
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

describe('money properties', () => {
  it('parse(format(x)) is the identity for every currency precision', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999_999 }), fc.constantFrom(0, 2, 3), (minor, dec) => {
        const r = parseAmount(minorToDecimalString(minor, dec), dec, { maxMajor: 1e12 });
        return r.ok && r.minor === minor;
      }),
    );
  });

  it('keypad output always parses (or is empty/zero)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('0', '1', '5', '9', '.', 'back'), { maxLength: 20 }), fc.constantFrom(0, 2), (keys, dec) => {
        const text = keys.reduce((s, k) => keypadInput(s, k, dec), '');
        if (text === '' || /^0?\.?0*$/.test(text)) return true;
        return parseAmount(text, dec).ok;
      }),
    );
  });

  it('conversion is monotonic and round-trips within one minor unit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), fc.integer({ min: 1, max: 1_000_000_000 }), (a, b) => {
        const rate = '0.86';
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (convertMinor(lo, 2, 2, rate) > convertMinor(hi, 2, 2, rate)) return false;
        const there = convertMinor(a, 2, 2, rate);
        const back = convertMinor(there, 2, 2, (1 / 0.86).toFixed(12));
        return Math.abs(back - a) <= 1;
      }),
    );
  });
});

it('fixture is consistent', () => {
  expect(verifyLedger(fixture().state).ok).toBe(true);
});
