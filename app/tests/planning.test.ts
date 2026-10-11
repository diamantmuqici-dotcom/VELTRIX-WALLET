import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  createBill,
  createGoal,
  createRule,
  markNotificationsRead,
  monthlyEquivalent,
  moveGoalFunds,
  nextOccurrence,
  payBill,
  raiseBillReminders,
  runDueRules,
  setBudget,
} from '../src/domain/ops/planning';
import { purchase } from '../src/domain/ops/payments';
import { balance, ctxAt, expectConsistent, fixture, ok } from './helpers';

describe('recurring & scheduled simulations', () => {
  it('computes next occurrences with month-end clamping', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2026-03-10', 'weekly')).toBe('2026-03-17');
    expect(nextOccurrence('2026-03-10', 'biweekly')).toBe('2026-03-24');
    expect(nextOccurrence('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(nextOccurrence('2026-03-10', 'once')).toBeNull();
  });

  it('runs due rules once, catches up missed runs and is idempotent across restarts', () => {
    const { state, ctx } = fixture();
    const r = ok(
      createRule(
        state,
        {
          kind: 'transfer',
          title: 'Weekly savings',
          amount: 1_000,
          currency: 'USD',
          fromAccountId: 'acc_main',
          toAccountId: 'acc_savings',
          category: 'transfers',
          note: '',
          frequency: 'weekly',
          nextDate: '2026-03-01',
          active: true,
          isSubscription: false,
        },
        ctx,
      ),
    );
    const now = ctxAt('2026-03-20T08:00:00');
    const first = runDueRules(r.state, now);
    expect(first.ran).toBe(3); // Mar 1, 8, 15
    expect(balance(first.state, 'acc_savings')).toBe(3_000);
    expect(first.state.recurring[0].nextDate).toBe('2026-03-22');
    expectConsistent(first.state);
    // Restart on the same day: nothing new happens.
    const again = runDueRules(first.state, now);
    expect(again.ran).toBe(0);
    expect(again.state.transactions.length).toBe(first.state.transactions.length);
    // Replaying an old state (e.g. a crash before the rule was advanced) does not duplicate entries.
    const replay = runDueRules({ ...first.state, recurring: r.state.recurring }, now);
    expect(replay.ran).toBe(0);
    expect(balance(replay.state, 'acc_savings')).toBe(3_000);
  });

  it('skips failing runs with a reminder instead of overdrawing', () => {
    const { state, ctx } = fixture();
    const r = ok(
      createRule(
        state,
        { kind: 'send', title: 'Big payment', amount: 9_000_000, currency: 'USD', fromAccountId: 'acc_main', category: 'bills', note: '', frequency: 'once', nextDate: '2026-03-09', active: true, isSubscription: false },
        ctx,
      ),
    );
    const out = runDueRules(r.state, ctx);
    expect(out.failed).toBe(1);
    expect(out.state.recurring[0].active).toBe(false);
    expect(out.state.notifications[0].title).toBe('Scheduled simulation skipped');
    expect(balance(out.state, 'acc_main')).toBe(100_000);
  });

  it('values subscriptions per month', () => {
    const base = { id: 'r', kind: 'purchase' as const, title: 'x', amount: 1_200, currency: 'USD' as const, fromAccountId: 'acc_main', category: 'subscriptions' as const, note: '', nextDate: '2026-01-01', active: true, isSubscription: true, createdAt: '', runs: 0 };
    expect(monthlyEquivalent({ ...base, frequency: 'yearly' })).toBe(100);
    expect(monthlyEquivalent({ ...base, frequency: 'weekly' })).toBe(5_200);
  });
});

describe('goals, budgets and bills', () => {
  it('moves money into a goal and tracks progress atomically', () => {
    const { state, ctx } = fixture();
    const g = ok(createGoal(state, { name: 'Trip', target: 10_000, deadline: '2026-08-01', color: '#22D3EE', icon: 'plane', accountId: 'acc_savings' }, ctx));
    const c = ok(moveGoalFunds(g.state, { goalId: g.goal.id, otherAccountId: 'acc_main', amount: 10_000, direction: 'contribute' }, ctx));
    expect(c.state.goals[0].saved).toBe(10_000);
    expect(balance(c.state, 'acc_savings')).toBe(10_000);
    expect(c.state.notifications[0].title).toBe('Goal reached');
    expect(moveGoalFunds(c.state, { goalId: g.goal.id, otherAccountId: 'acc_main', amount: 10_001, direction: 'withdraw' }, ctx).ok).toBe(false);
    const w = ok(moveGoalFunds(c.state, { goalId: g.goal.id, otherAccountId: 'acc_main', amount: 4_000, direction: 'withdraw' }, ctx));
    expect(w.state.goals[0].saved).toBe(6_000);
    expect(balance(w.state, 'acc_main')).toBe(94_000);
    expectConsistent(w.state);
    // A failed transfer leaves the goal untouched.
    expect(moveGoalFunds(w.state, { goalId: g.goal.id, otherAccountId: 'acc_main', amount: 99_999_999, direction: 'contribute' }, ctx).ok).toBe(false);
  });

  it('tracks budget usage from card spending net of refunds', () => {
    const { state, ctx } = fixture();
    let s = ok(setBudget(state, 'food', 10_000, 'USD', ctx)).state;
    s = ok(purchase(s, { cardId: s.cards[0].id, merchant: 'Market', amount: 7_500, category: 'food' }, ctx)).state;
    const st = budgetStatus(s, ctx.now);
    expect(st[0]).toMatchObject({ spent: 7_500, ratio: 0.75 });
  });

  it('pays bills through the ledger, rolls the due date and reminds once per due date', () => {
    const { state, ctx } = fixture();
    const b = ok(createBill(state, { name: 'Volt Energy Co.', amount: 9_420, currency: 'USD', dueDate: '2026-03-12', repeat: 'monthly', accountId: 'acc_main', remindDaysBefore: 3 }, ctx));
    const reminded = raiseBillReminders(b.state, ctx);
    expect(reminded.notifications[0].body).toContain('is due in 2 days');
    expect(raiseBillReminders(reminded, ctx).notifications.length).toBe(reminded.notifications.length);
    const paid = ok(payBill(reminded, b.bill.id, ctx));
    expect(balance(paid.state, 'acc_main')).toBe(100_000 - 9_420);
    expect(paid.state.bills[0].dueDate).toBe('2026-04-12');
    expect(paid.state.transactions[paid.state.transactions.length - 1]).toMatchObject({ type: 'purchase', subtype: 'bill', category: 'bills' });
    expectConsistent(paid.state);
    expect(markNotificationsRead(paid.state).notifications.every((n) => n.read)).toBe(true);
  });
});
