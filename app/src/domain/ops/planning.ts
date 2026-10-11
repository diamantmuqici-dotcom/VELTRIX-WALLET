import { addDays, addMonths, dayKey, daysBetween, isDayKey, parseDayKey, startOfMonth } from '../dates';
import { pushNotification, requireAccount } from '../ledger';
import type {
  AccountIcon,
  AppState,
  BillReminder,
  Budget,
  Category,
  Frequency,
  OpContext,
  OpResult,
  RecurringRule,
  SavingsGoal,
} from '../types';
import { cleanText, validateName } from '../validation';
import { fail, isValidAmount, money } from './common';
import { purchase, receiveMoney, sendMoney, transfer } from './payments';

/* ------------------------------------------------------------------ */
/* Savings goals                                                       */
/* ------------------------------------------------------------------ */

export interface GoalInput {
  name: string;
  target: number;
  deadline: string | null;
  color: string;
  icon: AccountIcon;
  accountId: string;
}

export function createGoal(state: AppState, input: GoalInput, ctx: OpContext): OpResult<{ goal: SavingsGoal }> {
  const e = validateName(input.name, 'Goal name');
  if (e) return fail('invalid_input', e);
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  if (!isValidAmount(input.target, acc.currency)) return fail('invalid_amount', 'Enter a target amount');
  if (input.deadline && !isDayKey(input.deadline)) return fail('invalid_input', 'Choose a valid date');
  const goal: SavingsGoal = {
    id: ctx.id('goal'),
    name: cleanText(input.name),
    target: input.target,
    saved: 0,
    currency: acc.currency,
    deadline: input.deadline,
    color: input.color,
    icon: input.icon,
    accountId: acc.id,
    createdAt: ctx.now.toISOString(),
  };
  return { ok: true, state: { ...state, goals: [...state.goals, goal] }, goal };
}

export function updateGoal(state: AppState, id: string, patch: Partial<Pick<SavingsGoal, 'name' | 'target' | 'deadline' | 'color' | 'icon'>>): OpResult {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return fail('invalid_input', 'Goal not found');
  if (patch.name !== undefined) {
    const e = validateName(patch.name, 'Goal name');
    if (e) return fail('invalid_input', e);
  }
  if (patch.target !== undefined && !isValidAmount(patch.target, g.currency)) return fail('invalid_amount');
  if (patch.deadline && !isDayKey(patch.deadline)) return fail('invalid_input', 'Choose a valid date');
  return { ok: true, state: { ...state, goals: state.goals.map((x) => (x.id === id ? { ...x, ...patch, name: patch.name ? cleanText(patch.name) : x.name } : x)) } };
}

export function deleteGoal(state: AppState, id: string): AppState {
  return { ...state, goals: state.goals.filter((g) => g.id !== id) };
}

/** Moves simulated money into (or out of) the goal's account and updates the goal tracker atomically. */
export function moveGoalFunds(
  state: AppState,
  input: { goalId: string; otherAccountId: string; amount: number; direction: 'contribute' | 'withdraw'; opKey?: string },
  ctx: OpContext,
): OpResult {
  const g = state.goals.find((x) => x.id === input.goalId);
  if (!g) return fail('invalid_input', 'Goal not found');
  if (input.direction === 'withdraw' && input.amount > g.saved) return fail('invalid_amount', 'You cannot withdraw more than the goal holds.');
  const r = transfer(
    state,
    {
      fromId: input.direction === 'contribute' ? input.otherAccountId : g.accountId,
      toId: input.direction === 'contribute' ? g.accountId : input.otherAccountId,
      amount: input.amount,
      note: `${input.direction === 'contribute' ? 'Saved toward' : 'Withdrawn from'} ${g.name}`,
      subtype: 'goal',
      goalId: g.id,
      opKey: input.opKey,
    },
    ctx,
  );
  if (!r.ok) return r;
  if (r.duplicate) return { ok: true, state: r.state, duplicate: true };
  const saved = input.direction === 'contribute' ? g.saved + input.amount : g.saved - input.amount;
  let next: AppState = { ...r.state, goals: r.state.goals.map((x) => (x.id === g.id ? { ...x, saved } : x)) };
  if (input.direction === 'contribute' && g.saved < g.target && saved >= g.target) {
    next = pushNotification(next, ctx, 'goal', 'Goal reached', `${g.name} reached its ${money(state, g.target, g.currency)} target (simulated).`, { screen: 'goals' });
  }
  return { ok: true, state: next };
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export function setBudget(state: AppState, category: Category, limit: number, currency: Budget['currency'], ctx: OpContext): OpResult {
  if (!isValidAmount(limit, currency)) return fail('invalid_amount');
  const existing = state.budgets.find((b) => b.category === category);
  const budgets = existing
    ? state.budgets.map((b) => (b.category === category ? { ...b, limit, currency } : b))
    : [...state.budgets, { id: ctx.id('bud'), category, limit, currency }];
  return { ok: true, state: { ...state, budgets } };
}

export function removeBudget(state: AppState, category: Category): AppState {
  return { ...state, budgets: state.budgets.filter((b) => b.category !== category) };
}

/* ------------------------------------------------------------------ */
/* Recurring & scheduled simulations                                   */
/* ------------------------------------------------------------------ */

export function nextOccurrence(day: string, frequency: Frequency): string | null {
  const d = parseDayKey(day);
  switch (frequency) {
    case 'once':
      return null;
    case 'weekly':
      return dayKey(addDays(d, 7));
    case 'biweekly':
      return dayKey(addDays(d, 14));
    case 'monthly':
      return dayKey(addMonths(d, 1));
    case 'yearly':
      return dayKey(addMonths(d, 12));
  }
}

export type RuleInput = Omit<RecurringRule, 'id' | 'createdAt' | 'runs' | 'lastRunAt'>;

export function validateRule(state: AppState, input: RuleInput): string | null {
  const n = validateName(input.title, 'Title');
  if (n) return n;
  const acc = state.accounts.find((a) => a.id === input.fromAccountId && !a.archived);
  if (!acc) return 'Choose an account';
  if (!isValidAmount(input.amount, acc.currency)) return 'Enter a valid amount';
  if (input.currency !== acc.currency) return 'Currency must match the account';
  if (!isDayKey(input.nextDate)) return 'Choose a valid date';
  if (input.kind === 'transfer') {
    const to = state.accounts.find((a) => a.id === input.toAccountId && !a.archived);
    if (!to) return 'Choose a destination account';
    if (to.id === acc.id) return 'Choose two different accounts';
    if (to.currency !== acc.currency) return 'Both accounts must use the same currency';
  }
  if (input.kind === 'purchase' && input.cardId && !state.cards.some((c) => c.id === input.cardId)) return 'Choose a card';
  return null;
}

export function createRule(state: AppState, input: RuleInput, ctx: OpContext): OpResult<{ rule: RecurringRule }> {
  const e = validateRule(state, input);
  if (e) return fail('invalid_input', e);
  const rule: RecurringRule = { ...input, title: cleanText(input.title), note: cleanText(input.note), id: ctx.id('rule'), createdAt: ctx.now.toISOString(), runs: 0 };
  return { ok: true, state: { ...state, recurring: [...state.recurring, rule] }, rule };
}

export function updateRule(state: AppState, id: string, input: RuleInput): OpResult {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return fail('invalid_input', 'Not found');
  const e = validateRule(state, input);
  if (e) return fail('invalid_input', e);
  return { ok: true, state: { ...state, recurring: state.recurring.map((x) => (x.id === id ? { ...x, ...input, title: cleanText(input.title), note: cleanText(input.note) } : x)) } };
}

export function deleteRule(state: AppState, id: string): AppState {
  return { ...state, recurring: state.recurring.filter((r) => r.id !== id) };
}

/** Executes one occurrence of a rule now (also used by "Run now"). */
export function runRuleOnce(state: AppState, rule: RecurringRule, occurrence: string, ctx: OpContext): OpResult {
  const opKey = `rule:${rule.id}:${occurrence}`;
  const subtype = rule.isSubscription ? 'subscription' : 'recurring';
  switch (rule.kind) {
    case 'send': {
      const c = state.contacts.find((x) => x.id === rule.contactId);
      const r = sendMoney(
        state,
        {
          recipient: c ? { contactId: c.id, name: c.name, handle: c.username } : { name: rule.title },
          amount: rule.amount,
          accountId: rule.fromAccountId,
          note: rule.note || `Scheduled: ${rule.title}`,
          category: rule.category,
          opKey,
        },
        ctx,
      );
      if (!r.ok) return r;
      return { ok: true, state: tagRule(r.state, r.txn.id, rule.id, subtype), duplicate: r.duplicate };
    }
    case 'receive': {
      const c = state.contacts.find((x) => x.id === rule.contactId);
      const r = receiveMoney(
        state,
        {
          from: c ? { contactId: c.id, name: c.name, handle: c.username } : { name: rule.title },
          amount: rule.amount,
          accountId: rule.fromAccountId,
          note: rule.note || `Scheduled: ${rule.title}`,
          category: rule.category,
          opKey,
        },
        ctx,
      );
      if (!r.ok) return r;
      return { ok: true, state: tagRule(r.state, r.txn.id, rule.id, subtype), duplicate: r.duplicate };
    }
    case 'transfer': {
      const r = transfer(state, { fromId: rule.fromAccountId, toId: rule.toAccountId ?? '', amount: rule.amount, note: rule.note || rule.title, subtype: 'recurring', opKey }, ctx);
      if (!r.ok) return r;
      return { ok: true, state: tagRule(r.state, r.txn.id, rule.id, 'recurring'), duplicate: r.duplicate };
    }
    case 'purchase': {
      if (rule.cardId) {
        const r = purchase(state, { cardId: rule.cardId, merchant: rule.title, amount: rule.amount, category: rule.category, note: rule.note, subtype, opKey }, ctx);
        if (!r.ok) return r;
        return { ok: true, state: tagRule(r.state, r.txn.id, rule.id, subtype), duplicate: r.duplicate };
      }
      const r = sendMoney(state, { recipient: { name: rule.title }, amount: rule.amount, accountId: rule.fromAccountId, note: rule.note, category: rule.category, opKey }, ctx);
      if (!r.ok) return r;
      const tagged = tagRule(r.state, r.txn.id, rule.id, subtype);
      return { ok: true, duplicate: r.duplicate, state: { ...tagged, transactions: tagged.transactions.map((t) => (t.id === r.txn.id ? { ...t, type: 'purchase' } : t)) } };
    }
  }
}

function tagRule(state: AppState, txnId: string, ruleId: string, subtype: 'recurring' | 'subscription'): AppState {
  return { ...state, transactions: state.transactions.map((t) => (t.id === txnId ? { ...t, subtype, links: { ...t.links, ruleId } } : t)) };
}

const MAX_CATCH_UP = 12;

/**
 * Runs every active rule whose next date is today or earlier. Each occurrence
 * carries an idempotency key so re-running (app restart, double resume) never
 * duplicates an entry. Failures are reported as notifications and skipped.
 */
export function runDueRules(state: AppState, ctx: OpContext): { state: AppState; ran: number; failed: number } {
  let next = state;
  let ran = 0;
  let failed = 0;
  const today = dayKey(ctx.now);
  for (const original of state.recurring) {
    if (!original.active) continue;
    let rule = next.recurring.find((r) => r.id === original.id) as RecurringRule;
    let guard = 0;
    while (rule.active && rule.nextDate <= today && guard < MAX_CATCH_UP) {
      guard++;
      const occurrence = rule.nextDate;
      const occCtx: OpContext = { now: occurrenceTime(occurrence, ctx.now), id: ctx.id };
      const r = runRuleOnce(next, rule, occurrence, occCtx);
      if (r.ok) {
        next = r.state;
        if (!r.duplicate) ran++;
      } else {
        failed++;
        next = pushNotification(next, ctx, 'reminder', 'Scheduled simulation skipped', `${rule.title} (${occurrence}) could not run: ${r.error.replace(/_/g, ' ')}.`, { screen: 'recurring' });
      }
      const following = nextOccurrence(occurrence, rule.frequency);
      rule = {
        ...rule,
        nextDate: following ?? rule.nextDate,
        active: following !== null && rule.active,
        runs: rule.runs + (r.ok ? 1 : 0),
        lastRunAt: r.ok ? ctx.now.toISOString() : rule.lastRunAt,
      };
      next = { ...next, recurring: next.recurring.map((x) => (x.id === rule.id ? rule : x)) };
    }
    if (guard >= MAX_CATCH_UP && rule.nextDate <= today) {
      // Too far behind: jump ahead without flooding the ledger.
      let d = rule.nextDate;
      while (d <= today) {
        const f = nextOccurrence(d, rule.frequency);
        if (!f) break;
        d = f;
      }
      rule = { ...rule, nextDate: d };
      next = { ...next, recurring: next.recurring.map((x) => (x.id === rule.id ? rule : x)) };
    }
  }
  return { state: next, ran, failed };
}

function occurrenceTime(day: string, now: Date): Date {
  const d = parseDayKey(day);
  if (dayKey(now) === day) return now;
  d.setHours(9, 0, 0, 0);
  return d;
}

export function monthlyEquivalent(rule: RecurringRule): number {
  switch (rule.frequency) {
    case 'weekly':
      return Math.round((rule.amount * 52) / 12);
    case 'biweekly':
      return Math.round((rule.amount * 26) / 12);
    case 'monthly':
      return rule.amount;
    case 'yearly':
      return Math.round(rule.amount / 12);
    default:
      return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Bill reminders                                                      */
/* ------------------------------------------------------------------ */

export type BillInput = Omit<BillReminder, 'id' | 'createdAt' | 'lastPaidAt' | 'remindedFor'>;

export function validateBill(state: AppState, input: BillInput): string | null {
  const n = validateName(input.name, 'Bill name');
  if (n) return n;
  const acc = state.accounts.find((a) => a.id === input.accountId && !a.archived);
  if (!acc) return 'Choose an account';
  if (!isValidAmount(input.amount, acc.currency)) return 'Enter a valid amount';
  if (!isDayKey(input.dueDate)) return 'Choose a valid due date';
  if (input.remindDaysBefore < 0 || input.remindDaysBefore > 30) return 'Reminder must be 0–30 days before';
  return null;
}

export function createBill(state: AppState, input: BillInput, ctx: OpContext): OpResult<{ bill: BillReminder }> {
  const e = validateBill(state, input);
  if (e) return fail('invalid_input', e);
  const acc = state.accounts.find((a) => a.id === input.accountId);
  const bill: BillReminder = { ...input, currency: acc?.currency ?? input.currency, name: cleanText(input.name), id: ctx.id('bill'), createdAt: ctx.now.toISOString() };
  return { ok: true, state: { ...state, bills: [...state.bills, bill] }, bill };
}

export function updateBill(state: AppState, id: string, input: BillInput): OpResult {
  const e = validateBill(state, input);
  if (e) return fail('invalid_input', e);
  const acc = state.accounts.find((a) => a.id === input.accountId);
  return {
    ok: true,
    state: { ...state, bills: state.bills.map((b) => (b.id === id ? { ...b, ...input, currency: acc?.currency ?? input.currency, name: cleanText(input.name), remindedFor: undefined } : b)) },
  };
}

export function deleteBill(state: AppState, id: string): AppState {
  return { ...state, bills: state.bills.filter((b) => b.id !== id) };
}

export function payBill(state: AppState, billId: string, ctx: OpContext): OpResult {
  const bill = state.bills.find((b) => b.id === billId);
  if (!bill) return fail('invalid_input', 'Bill not found');
  const r = sendMoney(
    state,
    { recipient: { name: bill.name }, amount: bill.amount, accountId: bill.accountId, note: `Bill due ${bill.dueDate}`, category: 'bills', opKey: `bill:${bill.id}:${bill.dueDate}` },
    ctx,
  );
  if (!r.ok) return r;
  const nextDue = bill.repeat === 'monthly' ? dayKey(addMonths(parseDayKey(bill.dueDate), 1)) : bill.repeat === 'yearly' ? dayKey(addMonths(parseDayKey(bill.dueDate), 12)) : bill.dueDate;
  let next: AppState = {
    ...r.state,
    transactions: r.state.transactions.map((t) => (t.id === r.txn.id ? { ...t, type: 'purchase', subtype: 'bill', links: { ...t.links, billId: bill.id } } : t)),
  };
  next =
    bill.repeat === 'none'
      ? { ...next, bills: next.bills.filter((b) => b.id !== bill.id) }
      : { ...next, bills: next.bills.map((b) => (b.id === bill.id ? { ...b, dueDate: nextDue, lastPaidAt: ctx.now.toISOString(), remindedFor: undefined } : b)) };
  return { ok: true, state: next };
}

/** Raises one in-app reminder per bill and due date when it enters its reminder window. */
export function raiseBillReminders(state: AppState, ctx: OpContext): AppState {
  let next = state;
  for (const bill of state.bills) {
    const days = daysBetween(ctx.now, parseDayKey(bill.dueDate));
    if (days <= bill.remindDaysBefore && bill.remindedFor !== bill.dueDate) {
      const when = days < 0 ? `was due ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'is due today' : `is due in ${days} day${days === 1 ? '' : 's'}`;
      next = pushNotification(next, ctx, 'reminder', 'Simulated bill reminder', `${bill.name} (${money(state, bill.amount, bill.currency)}) ${when}.`, { screen: 'bills' });
      next = { ...next, bills: next.bills.map((b) => (b.id === bill.id ? { ...b, remindedFor: bill.dueDate } : b)) };
    }
  }
  return next;
}

/** Budget alerts: one notification per category per month when spending crosses 100 %. */
export function budgetStatus(state: AppState, now: Date): Array<{ budget: Budget; spent: number; ratio: number }> {
  const from = startOfMonth(now).getTime();
  return state.budgets.map((budget) => {
    let spent = 0;
    for (const t of state.transactions) {
      if (t.category !== budget.category || t.currency !== budget.currency) continue;
      if (new Date(t.createdAt).getTime() < from) continue;
      if (t.status !== 'completed' && t.status !== 'reversed') continue;
      if (t.type === 'purchase' || t.type === 'send' || t.type === 'fee') spent += t.amount + t.fee;
      else if (t.type === 'refund') spent -= t.amount;
    }
    spent = Math.max(0, spent);
    return { budget, spent, ratio: budget.limit > 0 ? spent / budget.limit : 0 };
  });
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function markNotificationsRead(state: AppState, ids?: string[]): AppState {
  const set = ids ? new Set(ids) : null;
  return { ...state, notifications: state.notifications.map((n) => (!set || set.has(n.id) ? { ...n, read: true } : n)) };
}

export function clearNotifications(state: AppState): AppState {
  return { ...state, notifications: [] };
}
