import type { CurrencyCode } from './currency';
import { addDays, addMonths, dayKey, monthKeyOf, startOfDay, startOfMonth, startOfWeek } from './dates';
import { txnEffects } from './ledger';
import type { AppState, Category, Txn } from './types';

/**
 * Analytics over the local ledger. Only completed simulated activity is
 * counted; transfers between own accounts, exchanges, investment trades,
 * balance adjustments and reversed pairs are excluded so that moving money
 * around never looks like income or spending.
 */

export type Flow = 'income' | 'spending' | 'refund' | 'none';

export function flowOf(t: Txn): Flow {
  if (t.status !== 'completed') return 'none';
  if (t.links?.reversalOf) return 'none';
  switch (t.type) {
    case 'receive':
      return 'income';
    case 'send':
    case 'purchase':
    case 'fee':
      return 'spending';
    case 'refund':
      return 'refund';
    default:
      return 'none';
  }
}

/** Gross amount counted for analytics (positive). */
export function flowAmount(t: Txn): number {
  const f = flowOf(t);
  if (f === 'income') return t.amount;
  if (f === 'spending') return t.amount + t.fee;
  if (f === 'refund') return t.amount;
  return 0;
}

export interface AnalyticsFilter {
  from: Date;
  to: Date;
  currency: CurrencyCode;
  accountId?: string;
  cardId?: string;
}

export function analyticsEntries(state: AppState, f: AnalyticsFilter): Txn[] {
  const a = f.from.getTime();
  const b = f.to.getTime();
  return state.transactions.filter((t) => {
    if (t.currency !== f.currency) return false;
    if (flowOf(t) === 'none') return false;
    const time = new Date(t.createdAt).getTime();
    if (time < a || time > b) return false;
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.cardId && t.cardId !== f.cardId) return false;
    return true;
  });
}

export interface Breakdown<K extends string> {
  key: K;
  amount: number;
  count: number;
  share: number;
}

export interface Summary {
  income: number;
  spending: number;
  net: number;
  count: number;
  spendCount: number;
  largestSpend: Txn | null;
  largestIncome: Txn | null;
  averageSpend: number;
  byCategory: Breakdown<Category>[];
  byAccount: Breakdown<string>[];
  byCard: Breakdown<string>[];
}

function breakdown<K extends string>(map: Map<K, { amount: number; count: number }>, total: number): Breakdown<K>[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, amount: Math.max(0, v.amount), count: v.count, share: total > 0 ? Math.max(0, v.amount) / total : 0 }))
    .filter((x) => x.amount > 0)
    .sort((x, y) => y.amount - x.amount);
}

export function summarize(entries: Txn[]): Summary {
  let income = 0;
  let spending = 0;
  let spendCount = 0;
  let largestSpend: Txn | null = null;
  let largestIncome: Txn | null = null;
  const cat = new Map<Category, { amount: number; count: number }>();
  const acc = new Map<string, { amount: number; count: number }>();
  const card = new Map<string, { amount: number; count: number }>();
  const bump = <K>(m: Map<K, { amount: number; count: number }>, k: K, v: number, c: number) => {
    const cur = m.get(k) ?? { amount: 0, count: 0 };
    m.set(k, { amount: cur.amount + v, count: cur.count + c });
  };
  for (const t of entries) {
    const f = flowOf(t);
    const v = flowAmount(t);
    if (f === 'income') {
      income += v;
      if (!largestIncome || v > flowAmount(largestIncome)) largestIncome = t;
    } else if (f === 'spending' || f === 'refund') {
      const signed = f === 'spending' ? v : -v;
      spending += signed;
      if (f === 'spending') {
        spendCount++;
        if (!largestSpend || v > flowAmount(largestSpend)) largestSpend = t;
      }
      bump(cat, t.category, signed, f === 'spending' ? 1 : 0);
      bump(acc, t.accountId, signed, f === 'spending' ? 1 : 0);
      if (t.cardId) bump(card, t.cardId, signed, f === 'spending' ? 1 : 0);
    }
  }
  spending = Math.max(0, spending);
  return {
    income,
    spending,
    net: income - spending,
    count: entries.length,
    spendCount,
    largestSpend,
    largestIncome,
    averageSpend: spendCount > 0 ? Math.round(spending / spendCount) : 0,
    byCategory: breakdown(cat, spending),
    byAccount: breakdown(acc, spending),
    byCard: breakdown(card, spending),
  };
}

export interface PeriodComparison {
  current: Summary;
  previous: Summary;
  previousFrom: Date;
  previousTo: Date;
}

/** Compares the filter period with the immediately preceding period of equal length. */
export function comparePrevious(state: AppState, f: AnalyticsFilter): PeriodComparison {
  const span = f.to.getTime() - f.from.getTime();
  const previousTo = new Date(f.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - span);
  return {
    current: summarize(analyticsEntries(state, f)),
    previous: summarize(analyticsEntries(state, { ...f, from: previousFrom, to: previousTo })),
    previousFrom,
    previousTo,
  };
}

export type Bucket = 'day' | 'week' | 'month';

export interface TrendPoint {
  key: string;
  start: Date;
  income: number;
  spending: number;
}

export function trend(state: AppState, f: AnalyticsFilter, bucket: Bucket): TrendPoint[] {
  const points: TrendPoint[] = [];
  const index = new Map<string, TrendPoint>();
  const keyOf = (d: Date) => (bucket === 'day' ? dayKey(d) : bucket === 'week' ? dayKey(startOfWeek(d)) : monthKeyOf(d));
  let cursor = bucket === 'day' ? startOfDay(f.from) : bucket === 'week' ? startOfWeek(f.from) : startOfMonth(f.from);
  let guard = 0;
  while (cursor.getTime() <= f.to.getTime() && guard < 400) {
    const p = { key: keyOf(cursor), start: cursor, income: 0, spending: 0 };
    points.push(p);
    index.set(p.key, p);
    cursor = bucket === 'day' ? addDays(cursor, 1) : bucket === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1);
    guard++;
  }
  for (const t of analyticsEntries(state, f)) {
    const p = index.get(keyOf(new Date(t.createdAt)));
    if (!p) continue;
    const fl = flowOf(t);
    if (fl === 'income') p.income += flowAmount(t);
    else if (fl === 'spending') p.spending += flowAmount(t);
    else if (fl === 'refund') p.spending -= flowAmount(t);
  }
  for (const p of points) p.spending = Math.max(0, p.spending);
  return points;
}

/** Month-to-date income/spending in one currency (home "This month" card). */
export function monthToDate(state: AppState, currency: CurrencyCode, now: Date): PeriodComparison {
  const from = startOfMonth(now);
  const current = summarize(analyticsEntries(state, { from, to: now, currency }));
  const prevFrom = addMonths(from, -1);
  const prevTo = new Date(prevFrom.getTime() + (now.getTime() - from.getTime()));
  const previous = summarize(analyticsEntries(state, { from: prevFrom, to: prevTo, currency }));
  return { current, previous, previousFrom: prevFrom, previousTo: prevTo };
}

export interface AccountMonth {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
  opening: number;
  closing: number;
}

/** Monthly summary for one account, derived from applied ledger effects. */
export function accountMonths(state: AppState, accountId: string, months: number, now: Date): AccountMonth[] {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return [];
  const start = addMonths(startOfMonth(now), -(months - 1));
  const rows = new Map<string, AccountMonth>();
  for (let i = 0; i < months; i++) {
    const k = monthKeyOf(addMonths(start, i));
    rows.set(k, { month: k, inflow: 0, outflow: 0, net: 0, count: 0, opening: 0, closing: 0 });
  }
  let before = 0;
  for (const t of state.transactions) {
    for (const e of txnEffects(t)) {
      if (e.accountId !== accountId) continue;
      const time = new Date(t.createdAt);
      if (time < start) {
        before += e.delta;
        continue;
      }
      const row = rows.get(monthKeyOf(time));
      if (!row) continue;
      if (e.delta >= 0) row.inflow += e.delta;
      else row.outflow -= e.delta;
      row.net += e.delta;
      row.count++;
    }
  }
  let running = before;
  for (const row of rows.values()) {
    row.opening = running;
    running += row.net;
    row.closing = running;
  }
  return [...rows.values()].reverse();
}

/** Daily total balance of all visible asset accounts in one currency (home trend chart). */
export function balanceSeries(state: AppState, currency: CurrencyCode, days: number, now: Date): Array<{ day: string; value: number }> {
  const ids = new Set(state.accounts.filter((a) => a.currency === currency && a.kind !== 'credit' && !a.archived).map((a) => a.id));
  const start = startOfDay(addDays(now, -(days - 1)));
  let running = 0;
  const deltas = new Map<string, number>();
  for (const t of state.transactions) {
    for (const e of txnEffects(t)) {
      if (!ids.has(e.accountId)) continue;
      const time = new Date(t.createdAt);
      if (time < start) running += e.delta;
      else {
        const k = dayKey(time);
        deltas.set(k, (deltas.get(k) ?? 0) + e.delta);
      }
    }
  }
  const out: Array<{ day: string; value: number }> = [];
  for (let i = 0; i < days; i++) {
    const k = dayKey(addDays(start, i));
    running += deltas.get(k) ?? 0;
    out.push({ day: k, value: running });
  }
  return out;
}

export function currenciesWithActivity(state: AppState): CurrencyCode[] {
  const seen = new Map<CurrencyCode, number>();
  for (const t of state.transactions) if (flowOf(t) !== 'none') seen.set(t.currency, (seen.get(t.currency) ?? 0) + 1);
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
