import { MAX_BALANCE_MINOR } from './money';
import { monthKeyOf } from './dates';
import type { Account, AppNotification, AppState, NotificationKind, OpContext, OpError, Txn } from './types';

/**
 * Ledger engine.
 *
 *  - Every balance-changing event is a Txn.
 *  - `txnEffects` is the ONLY place that defines how an entry moves money.
 *  - `postTxn` applies those effects atomically to the in-memory copy of the
 *    state (all-or-nothing), recording balance-before/after snapshots.
 *  - `verifyLedger` recomputes every balance from scratch and reports drift.
 */

export interface Effect {
  accountId: string;
  delta: number;
}

export function txnEffects(t: Txn): Effect[] {
  if (!t.applied) return [];
  switch (t.direction) {
    case 'out':
      return [{ accountId: t.accountId, delta: -(t.amount + t.fee) }];
    case 'in':
      return [{ accountId: t.accountId, delta: t.amount - t.fee }];
    case 'internal': {
      const effects: Effect[] = [{ accountId: t.accountId, delta: -(t.amount + t.fee) }];
      if (t.toAccountId) effects.push({ accountId: t.toAccountId, delta: t.fx ? t.fx.targetAmount : t.amount });
      return effects;
    }
    default:
      return [];
  }
}

export function findAccount(state: AppState, id: string | undefined): Account | undefined {
  if (!id) return undefined;
  return state.accounts.find((a) => a.id === id);
}

export function requireAccount(state: AppState, id: string | undefined): Account | OpError {
  const a = findAccount(state, id);
  if (!a) return 'account_not_found';
  if (a.archived) return 'account_archived';
  return a;
}

/** Spendable amount: balance for asset accounts, remaining credit for credit accounts. */
export function availableFunds(account: Account): number {
  if (account.kind === 'credit') return (account.credit?.limit ?? 0) + account.balance;
  return account.balance;
}

/** Checks that `total` can leave `account` (only relevant when balances are tracked). */
export function checkDebit(state: AppState, account: Account, total: number, tracked = state.settings.trackBalances): OpError | null {
  if (!tracked) return null;
  if (account.kind === 'credit') return availableFunds(account) >= total ? null : 'insufficient_credit';
  return account.balance >= total ? null : 'insufficient_funds';
}

/**
 * Applies a Txn to the state. Pure: returns a new state object (structural
 * sharing). Throws if an affected account is missing or a balance would leave
 * the simulator's numeric range — callers validate before posting, so a throw
 * indicates a programming error and leaves the original state untouched.
 */
export function postTxn(state: AppState, txn: Txn): AppState {
  const effects = txnEffects(txn);
  const entry: Txn = { ...txn };
  let accounts = state.accounts;
  if (effects.length > 0) {
    accounts = state.accounts.map((a) => ({ ...a }));
    for (const e of effects) {
      const acc = accounts.find((a) => a.id === e.accountId);
      if (!acc) throw new Error(`postTxn: account ${e.accountId} missing`);
      const before = acc.balance;
      const after = before + e.delta;
      if (!Number.isSafeInteger(after) || Math.abs(after) > MAX_BALANCE_MINOR) throw new Error('postTxn: balance out of range');
      acc.balance = after;
      if (e.accountId === txn.accountId && entry.balanceBefore === undefined) {
        entry.balanceBefore = before;
        entry.balanceAfter = after;
      } else if (e.accountId === txn.toAccountId) {
        entry.toBalanceBefore = before;
        entry.toBalanceAfter = after;
      }
    }
  }
  return { ...state, accounts, transactions: [...state.transactions, entry] };
}

/** Applies the effects of an existing (previously unapplied) entry, e.g. when a pending simulation completes. */
export function applyExisting(state: AppState, txnId: string, patch: Partial<Txn>): AppState {
  const idx = state.transactions.findIndex((t) => t.id === txnId);
  if (idx === -1) throw new Error('applyExisting: missing txn');
  const updated: Txn = { ...state.transactions[idx], ...patch };
  const effects = txnEffects(updated);
  let accounts = state.accounts;
  if (effects.length > 0) {
    accounts = state.accounts.map((a) => ({ ...a }));
    for (const e of effects) {
      const acc = accounts.find((a) => a.id === e.accountId);
      if (!acc) throw new Error('applyExisting: account missing');
      const before = acc.balance;
      const after = before + e.delta;
      if (!Number.isSafeInteger(after) || Math.abs(after) > MAX_BALANCE_MINOR) throw new Error('applyExisting: balance out of range');
      acc.balance = after;
      if (e.accountId === updated.accountId) {
        updated.balanceBefore = before;
        updated.balanceAfter = after;
      } else if (e.accountId === updated.toAccountId) {
        updated.toBalanceBefore = before;
        updated.toBalanceAfter = after;
      }
    }
  }
  const transactions = state.transactions.slice();
  transactions[idx] = updated;
  return { ...state, accounts, transactions };
}

export function patchTxn(state: AppState, txnId: string, patch: Partial<Txn>): AppState {
  return {
    ...state,
    transactions: state.transactions.map((t) => (t.id === txnId ? { ...t, ...patch, links: { ...t.links, ...patch.links } } : t)),
  };
}

export interface LedgerDrift {
  accountId: string;
  expected: number;
  actual: number;
}

/** Recomputes every balance from the ledger. ok=false means stored balances drifted. */
export function verifyLedger(state: AppState): { ok: boolean; drift: LedgerDrift[] } {
  const sums = new Map<string, number>();
  for (const a of state.accounts) sums.set(a.id, 0);
  for (const t of state.transactions) {
    for (const e of txnEffects(t)) sums.set(e.accountId, (sums.get(e.accountId) ?? 0) + e.delta);
  }
  const drift: LedgerDrift[] = [];
  for (const a of state.accounts) {
    const expected = sums.get(a.id) ?? 0;
    if (expected !== a.balance) drift.push({ accountId: a.id, expected, actual: a.balance });
  }
  for (const [id, expected] of sums) {
    if (!state.accounts.some((a) => a.id === id) && expected !== 0) drift.push({ accountId: id, expected, actual: 0 });
  }
  return { ok: drift.length === 0, drift };
}

/** Repairs stored balances from the ledger (used for imports of hand-edited files). */
export function recomputeBalances(state: AppState): AppState {
  const sums = new Map<string, number>();
  for (const t of state.transactions) for (const e of txnEffects(t)) sums.set(e.accountId, (sums.get(e.accountId) ?? 0) + e.delta);
  return { ...state, accounts: state.accounts.map((a) => ({ ...a, balance: sums.get(a.id) ?? 0 })) };
}

/* ------------------------- Idempotency ----------------------------- */

const OPS_KEEP = 200;

export function findProcessedOp(state: AppState, opKey: string | undefined): string | null {
  if (!opKey) return null;
  const prefix = `${opKey}=>`;
  const hit = state.meta.processedOps.find((k) => k.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

export function recordOp(state: AppState, opKey: string | undefined, resultId: string): AppState {
  if (!opKey) return state;
  const processedOps = [...state.meta.processedOps, `${opKey}=>${resultId}`].slice(-OPS_KEEP);
  return { ...state, meta: { ...state.meta, processedOps } };
}

/* ------------------------- Notifications --------------------------- */

const NOTIF_KEEP = 100;

export function pushNotification(
  state: AppState,
  ctx: OpContext,
  kind: NotificationKind,
  title: string,
  body: string,
  target?: AppNotification['target'],
): AppState {
  const prefs = state.settings.notifications;
  const allowed =
    kind === 'payment'
      ? prefs.payments
      : kind === 'request'
        ? prefs.requests
        : kind === 'reminder'
          ? prefs.reminders
          : kind === 'market'
            ? prefs.markets
            : kind === 'budget' || kind === 'goal'
              ? prefs.budgets
              : true;
  if (!allowed) return state;
  const n: AppNotification = { id: ctx.id('ntf'), kind, title, body, createdAt: ctx.now.toISOString(), read: false, target };
  return { ...state, notifications: [n, ...state.notifications].slice(0, NOTIF_KEEP) };
}

/* ---------------------------- Queries ------------------------------ */

/** Simulated card spending in a month: purchases minus refunds charged to that card. */
export function cardSpend(state: AppState, cardId: string, month: string): number {
  let total = 0;
  for (const t of state.transactions) {
    if (t.cardId !== cardId) continue;
    if (monthKeyOf(t.createdAt) !== month) continue;
    if (t.type === 'purchase' && (t.status === 'completed' || t.status === 'reversed')) total += t.amount;
    else if (t.type === 'refund' && t.status === 'completed') total -= t.amount;
  }
  return Math.max(0, total);
}

export function txnsForAccount(state: AppState, accountId: string): Txn[] {
  return state.transactions.filter((t) => t.accountId === accountId || t.toAccountId === accountId);
}

/** Signed effect of a txn on one account (0 when not applied). */
export function effectOn(t: Txn, accountId: string): number {
  let d = 0;
  for (const e of txnEffects(t)) if (e.accountId === accountId) d += e.delta;
  return d;
}

/** Signed display amount of an entry from the user's point of view for a given account. */
export function signedAmountFor(t: Txn, accountId?: string): number {
  if (t.direction === 'in') return t.amount - t.fee;
  if (t.direction === 'out') return -(t.amount + t.fee);
  if (accountId && t.toAccountId === accountId && t.accountId !== accountId) return t.fx ? t.fx.targetAmount : t.amount;
  return -(t.amount + t.fee);
}

/**
 * Replays the whole ledger in order, recomputing balances and every entry's
 * balance-before/after snapshot. Returns the lowest balance each account
 * reached (used to validate generated or imported histories).
 */
export function rebuildSnapshots(state: AppState): { state: AppState; minBalance: Map<string, number>; maxBalance: Map<string, number> } {
  const bal = new Map<string, number>();
  const minBalance = new Map<string, number>();
  const maxBalance = new Map<string, number>();
  for (const a of state.accounts) {
    bal.set(a.id, 0);
    minBalance.set(a.id, 0);
    maxBalance.set(a.id, 0);
  }
  const transactions = state.transactions.map((t) => {
    const effects = txnEffects(t);
    if (effects.length === 0) return t;
    const next: Txn = { ...t };
    for (const e of effects) {
      const before = bal.get(e.accountId) ?? 0;
      const after = before + e.delta;
      bal.set(e.accountId, after);
      minBalance.set(e.accountId, Math.min(minBalance.get(e.accountId) ?? 0, after));
      maxBalance.set(e.accountId, Math.max(maxBalance.get(e.accountId) ?? 0, after));
      if (e.accountId === t.accountId) {
        next.balanceBefore = before;
        next.balanceAfter = after;
      } else if (e.accountId === t.toAccountId) {
        next.toBalanceBefore = before;
        next.toBalanceAfter = after;
      }
    }
    return next;
  });
  const accounts = state.accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
  return { state: { ...state, accounts, transactions }, minBalance, maxBalance };
}
