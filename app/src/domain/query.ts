import { CURRENCIES, type CurrencyCode } from './currency';
import { endOfDay, monthKeyOf, parseDayKey } from './dates';
import { simRef } from './ids';
import { CATEGORY_LABEL, txnTypeLabel } from './labels';
import { effectOn } from './ledger';
import { minorToDecimalString, pow10 } from './money';
import type { AppState, Category, DayKey, Txn, TxnStatus, TxnType } from './types';

export type SortOrder = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export const SORT_LABEL: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  amount_desc: 'Largest amount',
  amount_asc: 'Smallest amount',
};

export interface LedgerFilter {
  text: string;
  types: TxnType[];
  categories: Category[];
  statuses: TxnStatus[];
  accountId: string | null;
  cardId: string | null;
  from: DayKey | null;
  to: DayKey | null;
  /** inclusive bounds in MAJOR units of each entry's own currency (e.g. 12.5 = $12.50 or ¥12.5) */
  minAmount: number | null;
  maxAmount: number | null;
  sort: SortOrder;
}

export const EMPTY_FILTER: LedgerFilter = {
  text: '',
  types: [],
  categories: [],
  statuses: [],
  accountId: null,
  cardId: null,
  from: null,
  to: null,
  minAmount: null,
  maxAmount: null,
  sort: 'newest',
};

export function activeFilterCount(f: LedgerFilter): number {
  let n = 0;
  if (f.types.length) n++;
  if (f.categories.length) n++;
  if (f.statuses.length) n++;
  if (f.accountId) n++;
  if (f.cardId) n++;
  if (f.from || f.to) n++;
  if (f.minAmount !== null || f.maxAmount !== null) n++;
  return n;
}

function haystack(state: AppState, t: Txn): string {
  const acc = state.accounts.find((a) => a.id === t.accountId);
  const to = t.toAccountId ? state.accounts.find((a) => a.id === t.toAccountId) : undefined;
  const card = t.cardId ? state.cards.find((c) => c.id === t.cardId) : undefined;
  return [
    t.title,
    t.note,
    t.counterparty?.name,
    t.counterparty?.handle ? `@${t.counterparty.handle}` : '',
    CATEGORY_LABEL[t.category],
    txnTypeLabel(t),
    t.tags.map((x) => `#${x}`).join(' '),
    acc?.name,
    to?.name,
    card?.nickname,
    t.currency,
    minorToDecimalString(t.amount, CURRENCIES[t.currency].decimals),
    simRef(t.id),
    t.trade?.symbol,
  ]
    .filter(Boolean)
    .join(' \u0001 ')
    .toLowerCase();
}

export function filterLedger(state: AppState, f: LedgerFilter): Txn[] {
  const terms = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const from = f.from ? parseDayKey(f.from).getTime() : null;
  const to = f.to ? endOfDay(parseDayKey(f.to)).getTime() : null;
  const out = state.transactions.filter((t) => {
    if (f.types.length && !f.types.includes(t.type)) return false;
    if (f.categories.length && !f.categories.includes(t.category)) return false;
    if (f.statuses.length && !f.statuses.includes(t.status)) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (f.cardId && t.cardId !== f.cardId) return false;
    if (from !== null || to !== null) {
      const time = new Date(t.createdAt).getTime();
      if (from !== null && time < from) return false;
      if (to !== null && time > to) return false;
    }
    if (f.minAmount !== null || f.maxAmount !== null) {
      const major = t.amount / pow10(CURRENCIES[t.currency].decimals);
      if (f.minAmount !== null && major < f.minAmount - 1e-9) return false;
      if (f.maxAmount !== null && major > f.maxAmount + 1e-9) return false;
    }
    if (terms.length) {
      const h = haystack(state, t);
      for (const term of terms) if (!h.includes(term)) return false;
    }
    return true;
  });
  return sortLedger(out, f.sort);
}

export function sortLedger(txns: Txn[], sort: SortOrder): Txn[] {
  const withIndex = txns.map((t, i) => ({ t, i, time: new Date(t.createdAt).getTime() }));
  withIndex.sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return a.time - b.time || a.i - b.i;
      case 'amount_desc':
        return b.t.amount - a.t.amount || b.time - a.time;
      case 'amount_asc':
        return a.t.amount - b.t.amount || b.time - a.time;
      default:
        return b.time - a.time || b.i - a.i;
    }
  });
  return withIndex.map((x) => x.t);
}

export interface Totals {
  currency: CurrencyCode;
  inflow: number;
  outflow: number;
  net: number;
}

/**
 * Money in/out for a list of entries, per currency. Only entries that moved
 * simulated balances are counted. Internal moves count only their fees unless
 * an account is selected, in which case the account's own effects are used.
 */
export function ledgerTotals(txns: Txn[], accountId: string | null, accounts: AppState['accounts']): Totals[] {
  const map = new Map<CurrencyCode, Totals>();
  const bump = (c: CurrencyCode, delta: number) => {
    const cur = map.get(c) ?? { currency: c, inflow: 0, outflow: 0, net: 0 };
    if (delta >= 0) cur.inflow += delta;
    else cur.outflow -= delta;
    cur.net += delta;
    map.set(c, cur);
  };
  for (const t of txns) {
    if (!t.applied) continue;
    if (accountId) {
      const acc = accounts.find((a) => a.id === accountId);
      const d = effectOn(t, accountId);
      if (d !== 0 && acc) bump(acc.currency, d);
      continue;
    }
    if (t.direction === 'in') bump(t.currency, t.amount - t.fee);
    else if (t.direction === 'out') bump(t.currency, -(t.amount + t.fee));
    else if (t.fee > 0) bump(t.currency, -t.fee);
  }
  return [...map.values()].sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
}

export interface MonthGroup {
  month: string;
  items: Txn[];
}

/** Groups an already-sorted list by calendar month, preserving order. */
export function groupByMonth(txns: Txn[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let current: MonthGroup | null = null;
  for (const t of txns) {
    const m = monthKeyOf(t.createdAt);
    if (!current || current.month !== m) {
      current = { month: m, items: [] };
      groups.push(current);
    }
    current.items.push(t);
  }
  return groups;
}
