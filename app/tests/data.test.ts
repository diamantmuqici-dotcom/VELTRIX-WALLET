import { describe, expect, it } from 'vitest';
import { analyticsEntries, comparePrevious, monthToDate, summarize, trend, accountMonths, balanceSeries } from '../src/domain/analytics';
import { ledgerToCsv } from '../src/domain/csv';
import { simRef } from '../src/domain/ids';
import { exchange, purchase, receiveMoney, reverseTxn, sendMoney, transfer } from '../src/domain/ops/payments';
import { EMPTY_FILTER, filterLedger, groupByMonth, ledgerTotals } from '../src/domain/query';
import { loadState, makeBackup } from '../src/domain/schema';
import type { AppState } from '../src/domain/types';
import { ctxAt, fixture, ok } from './helpers';

function withActivity(): AppState {
  let { state: s } = fixture();
  const card = s.cards[0].id;
  s = ok(receiveMoney(s, { from: { name: 'Employer' }, amount: 300_000, accountId: 'acc_main' }, ctxAt('2026-03-01T09:00:00'))).state;
  s = ok(purchase(s, { cardId: card, merchant: 'Green Basket Market', amount: 5_000, category: 'food' }, ctxAt('2026-03-02T12:00:00'))).state;
  s = ok(purchase(s, { cardId: card, merchant: 'Urban Threads', amount: 12_000, category: 'shopping' }, ctxAt('2026-03-03T12:00:00'))).state;
  const p = ok(purchase(s, { cardId: card, merchant: 'Pixel Plaza', amount: 40_000, category: 'shopping' }, ctxAt('2026-03-04T12:00:00')));
  s = ok(reverseTxn(p.state, p.txn.id, ctxAt('2026-03-05T12:00:00'))).state;
  s = ok(sendMoney(s, { recipient: { name: 'Noah' }, amount: 2_000, accountId: 'acc_main', note: '=HYPERLINK("x")' }, ctxAt('2026-03-06T12:00:00'))).state;
  s = ok(transfer(s, { fromId: 'acc_main', toId: 'acc_savings', amount: 50_000 }, ctxAt('2026-03-07T12:00:00'))).state;
  s = ok(exchange(s, { fromId: 'acc_main', toId: 'acc_eur', amount: 10_000, rate: '0.86', rateSource: 'demo', rateTimestamp: '2026-01-01T00:00:00Z' }, ctxAt('2026-03-08T12:00:00'))).state;
  s = ok(purchase(s, { cardId: card, merchant: 'Green Basket Market', amount: 7_000, category: 'food' }, ctxAt('2026-02-15T12:00:00'))).state;
  return s;
}

describe('analytics', () => {
  it('counts income and spending but not transfers, exchanges or reversed pairs', () => {
    const s = withActivity();
    const f = { from: new Date('2026-03-01T00:00:00'), to: new Date('2026-03-31T23:59:59'), currency: 'USD' as const };
    const sum = summarize(analyticsEntries(s, f));
    expect(sum.income).toBe(300_000);
    expect(sum.spending).toBe(5_000 + 12_000 + 2_000);
    expect(sum.net).toBe(300_000 - 19_000);
    expect(sum.largestSpend?.title).toBe('Urban Threads');
    expect(sum.byCategory[0]).toMatchObject({ key: 'shopping', amount: 12_000 });
    expect(sum.averageSpend).toBe(Math.round(19_000 / 3));
  });

  it('compares against the previous equal-length period', () => {
    const s = withActivity();
    const cmp = comparePrevious(s, { from: new Date('2026-03-01T00:00:00'), to: new Date('2026-03-15T23:59:59'), currency: 'USD' });
    expect(cmp.previous.spending).toBe(7_000);
    expect(cmp.current.spending).toBe(19_000);
    const mtd = monthToDate(s, 'USD', new Date('2026-03-10T12:00:00'));
    expect(mtd.current.income).toBe(300_000);
  });

  it('builds daily trends and an empty state with no data', () => {
    const s = withActivity();
    const t = trend(s, { from: new Date('2026-03-01T00:00:00'), to: new Date('2026-03-07T23:59:59'), currency: 'USD' }, 'day');
    expect(t.length).toBe(7);
    expect(t[0].income).toBe(300_000);
    expect(t[2].spending).toBe(12_000);
    const empty = summarize([]);
    expect(empty).toMatchObject({ income: 0, spending: 0, net: 0, largestSpend: null, byCategory: [] });
  });

  it('summarizes accounts per month from ledger effects', () => {
    const s = withActivity();
    const rows = accountMonths(s, 'acc_savings', 3, new Date('2026-03-20T12:00:00'));
    expect(rows[0]).toMatchObject({ month: '2026-03', inflow: 50_000, closing: 50_000 });
    const series = balanceSeries(s, 'USD', 10, new Date('2026-03-10T12:00:00'));
    expect(series.length).toBe(10);
  });
});

describe('ledger search & filters', () => {
  it('searches across names, notes, references and amounts', () => {
    const s = withActivity();
    expect(filterLedger(s, { ...EMPTY_FILTER, text: 'green basket' }).length).toBe(2);
    expect(filterLedger(s, { ...EMPTY_FILTER, text: '120.00' })[0].title).toBe('Urban Threads');
    const anyTxn = s.transactions[3];
    expect(filterLedger(s, { ...EMPTY_FILTER, text: simRef(anyTxn.id) }).map((t) => t.id)).toContain(anyTxn.id);
  });

  it('filters by type, category, account, card, date and amount; sorts 4 ways', () => {
    const s = withActivity();
    expect(filterLedger(s, { ...EMPTY_FILTER, types: ['purchase'] }).length).toBe(4);
    expect(filterLedger(s, { ...EMPTY_FILTER, categories: ['food'] }).length).toBe(2);
    expect(filterLedger(s, { ...EMPTY_FILTER, accountId: 'acc_savings' }).length).toBe(1); // transfer in (opened at zero)
    expect(filterLedger(s, { ...EMPTY_FILTER, cardId: s.cards[0].id }).length).toBe(5); // 4 purchases + refund
    expect(filterLedger(s, { ...EMPTY_FILTER, from: '2026-03-02', to: '2026-03-03' }).length).toBe(2);
    expect(filterLedger(s, { ...EMPTY_FILTER, minAmount: 100, maxAmount: 120, types: ['purchase'] }).length).toBe(1);
    const newest = filterLedger(s, { ...EMPTY_FILTER, sort: 'newest' });
    const oldest = filterLedger(s, { ...EMPTY_FILTER, sort: 'oldest' });
    expect(newest[0].id).toBe(oldest[oldest.length - 1].id);
    const big = filterLedger(s, { ...EMPTY_FILTER, sort: 'amount_desc' });
    const small = filterLedger(s, { ...EMPTY_FILTER, sort: 'amount_asc' });
    expect(big[0].amount).toBeGreaterThanOrEqual(big[1].amount);
    expect(small[0].amount).toBeLessThanOrEqual(small[1].amount);
  });

  it('groups by month and totals money in/out', () => {
    const s = withActivity();
    const list = filterLedger(s, EMPTY_FILTER);
    const groups = groupByMonth(list);
    expect(groups.map((g) => g.month)).toEqual(['2026-03', '2026-02']);
    const totals = ledgerTotals(filterLedger(s, { ...EMPTY_FILTER, accountId: 'acc_savings' }), 'acc_savings', s.accounts);
    expect(totals[0]).toMatchObject({ currency: 'USD', inflow: 50_000, outflow: 0, net: 50_000 });
  });
});

describe('export & import', () => {
  it('exports CSV marked as simulated and neutralises formulas', () => {
    const s = withActivity();
    const csv = ledgerToCsv(s, s.transactions);
    const lines = csv.trim().split('\r\n');
    expect(lines[0].startsWith('Simulation,Date')).toBe(true);
    expect(lines.slice(1).every((l) => l.startsWith('SIMULATED,'))).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it('round-trips a backup and rejects bad files', () => {
    const s = withActivity();
    const backup = makeBackup(s, new Date('2026-03-10T00:00:00Z'));
    const r = loadState(JSON.parse(backup));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.transactions).toEqual(s.transactions);
      expect(r.state.accounts).toEqual(s.accounts);
      expect(r.repaired).toBe(false);
    }
    expect(loadState(null).ok).toBe(false);
    expect(loadState({ format: 'veltrix-backup' }).ok).toBe(false);
    expect(loadState({ ...s, schemaVersion: 99 }).ok).toBe(false);
    expect(loadState({ ...s, accounts: s.accounts.filter((a) => a.id !== 'acc_main') }).ok).toBe(false);
    expect(loadState({ ...s, transactions: [{ ...s.transactions[0], amount: 1.5 }] }).ok).toBe(false);
    expect(loadState({ ...s, transactions: [{ ...s.transactions[0], accountId: 'ghost' }] }).ok).toBe(false);
    expect(loadState({ ...s, cards: [{ ...s.cards[0], displayDigits: '4111111111111111' }] }).ok).toBe(false);
  });

  it('repairs drifted balances from the ledger instead of trusting them', () => {
    const s = withActivity();
    const tampered = { ...s, accounts: s.accounts.map((a) => (a.id === 'acc_main' ? { ...a, balance: a.balance + 999_999 } : a)) };
    const r = loadState(JSON.parse(JSON.stringify(tampered)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repaired).toBe(true);
      expect(r.state.accounts.find((a) => a.id === 'acc_main')?.balance).toBe(s.accounts.find((a) => a.id === 'acc_main')?.balance);
      expect(r.warnings.length).toBe(1);
    }
  });

  it('fills missing settings with defaults for older files', () => {
    const s = withActivity();
    const partial = JSON.parse(JSON.stringify(s));
    delete partial.settings.fees;
    partial.settings.dashboard = [{ id: 'recent', visible: true }, { id: 'bogus', visible: true }];
    partial.schemaVersion = undefined;
    const r = loadState(partial);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.settings.fees.exchange.bps).toBe(50);
      expect(r.state.settings.dashboard.length).toBe(13);
      expect(r.state.settings.dashboard[0]).toEqual({ id: 'recent', visible: true });
    }
  });
});
