import { describe, expect, it } from 'vitest';
import { crossRate, DEMO_RATES } from '../src/domain/fx';
import {
  adjustBalance,
  cancelPending,
  completePending,
  createRequest,
  deleteTxn,
  exchange,
  purchase,
  receiveMoney,
  resolveRequest,
  reverseTxn,
  sendMoney,
  transfer,
  updateTxnDetails,
} from '../src/domain/ops/payments';
import { balance, ctxAt, expectConsistent, fixture, ok } from './helpers';

describe('send money simulation', () => {
  it('debits the account, records snapshots and stays consistent', () => {
    const { state, ctx } = fixture();
    const contact = state.contacts[0];
    const r = ok(sendMoney(state, { recipient: { contactId: contact.id, name: contact.name }, amount: 2_550, accountId: 'acc_main', note: 'Dinner 🍜' }, ctx));
    expect(balance(r.state, 'acc_main')).toBe(100_000 - 2_550);
    expect(r.txn.balanceBefore).toBe(100_000);
    expect(r.txn.balanceAfter).toBe(97_450);
    expect(r.txn.status).toBe('completed');
    expect(r.txn.note).toBe('Dinner 🍜');
    expect(r.state.notifications[0].title).toBe('Simulation completed');
    expectConsistent(r.state);
  });

  it('charges the instant fee on top of the amount', () => {
    const { state, ctx } = fixture();
    const r = ok(sendMoney(state, { recipient: { name: 'Noah' }, amount: 10_000, accountId: 'acc_main', instant: true }, ctx));
    expect(r.txn.fee).toBe(150); // 1.5 %
    expect(balance(r.state, 'acc_main')).toBe(100_000 - 10_150);
    expectConsistent(r.state);
  });

  it('validates recipient, amount, funds and note length', () => {
    const { state, ctx } = fixture();
    expect(sendMoney(state, { recipient: null, amount: 100, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'missing_recipient' });
    expect(sendMoney(state, { recipient: { name: '  ' }, amount: 100, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'missing_recipient' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 0, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'missing_amount' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: -5, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'invalid_amount' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 1.5, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'invalid_amount' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 100_001, accountId: 'acc_main' }, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 100, accountId: 'nope' }, ctx)).toMatchObject({ ok: false, error: 'account_not_found' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 100, accountId: 'acc_invest' }, ctx)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 100, accountId: 'acc_main', note: '😀'.repeat(141) }, ctx)).toMatchObject({ ok: false, error: 'note_too_long' });
    // 140 emoji are fine — length is counted in graphemes.
    expect(sendMoney(state, { recipient: { name: 'A' }, amount: 100, accountId: 'acc_main', note: '👩‍👩‍👧'.repeat(140) }, ctx).ok).toBe(true);
  });

  it('is idempotent for the same operation key (double tap)', () => {
    const { state, ctx } = fixture();
    const input = { recipient: { name: 'Noah' }, amount: 1_000, accountId: 'acc_main', opKey: 'send-1' };
    const a = ok(sendMoney(state, input, ctx));
    const b = ok(sendMoney(a.state, input, ctx));
    expect(b.duplicate).toBe(true);
    expect(b.state).toBe(a.state);
    expect(b.state.transactions.length).toBe(a.state.transactions.length);
    expect(balance(b.state, 'acc_main')).toBe(99_000);
  });

  it('pending simulations move money only when completed', () => {
    const { state, ctx } = fixture();
    const p = ok(sendMoney(state, { recipient: { name: 'Noah' }, amount: 5_000, accountId: 'acc_main', outcome: 'pending' }, ctx));
    expect(balance(p.state, 'acc_main')).toBe(100_000);
    expect(p.txn.applied).toBe(false);
    const done = ok(completePending(p.state, p.txn.id, ctx));
    expect(balance(done.state, 'acc_main')).toBe(95_000);
    expect(done.txn.status).toBe('completed');
    expectConsistent(done.state);
    expect(completePending(done.state, p.txn.id, ctx)).toMatchObject({ ok: false, error: 'txn_not_pending' });
    const p2 = ok(sendMoney(done.state, { recipient: { name: 'Noah' }, amount: 5_000, accountId: 'acc_main', outcome: 'pending' }, ctx));
    const canceled = ok(cancelPending(p2.state, p2.txn.id, ctx));
    expect(canceled.txn.status).toBe('canceled');
    expect(balance(canceled.state, 'acc_main')).toBe(95_000);
    expectConsistent(canceled.state);
  });

  it('records but does not apply activity when balance tracking is off', () => {
    const { state, ctx } = fixture();
    const off = { ...state, settings: { ...state.settings, trackBalances: false } };
    const r = ok(sendMoney(off, { recipient: { name: 'Noah' }, amount: 900_000, accountId: 'acc_main' }, ctx));
    expect(balance(r.state, 'acc_main')).toBe(100_000);
    expect(r.txn.untracked).toBe(true);
    expect(r.txn.applied).toBe(false);
    expectConsistent(r.state);
    // Manual adjustments always apply.
    const adj = ok(adjustBalance(r.state, { accountId: 'acc_main', mode: 'add', amount: 500 }, ctx));
    expect(balance(adj.state, 'acc_main')).toBe(100_500);
  });
});

describe('receive & requests', () => {
  it('receives a simulated incoming payment', () => {
    const { state, ctx } = fixture();
    const r = ok(receiveMoney(state, { from: { name: 'Zara' }, amount: 4_200, accountId: 'acc_eur', note: 'Brunch' }, ctx));
    expect(balance(r.state, 'acc_eur')).toBe(24_200);
    expect(r.txn.currency).toBe('EUR');
    expectConsistent(r.state);
  });

  it('outgoing request: accept credits the account, cancel does not', () => {
    const { state, ctx } = fixture();
    const req = ok(createRequest(state, { party: { name: 'Ava' }, amount: 2_400, accountId: 'acc_main', note: 'Pizza 🍕' }, ctx));
    expect(req.request.status).toBe('pending');
    expect(balance(req.state, 'acc_main')).toBe(100_000);
    const acc = ok(resolveRequest(req.state, req.request.id, 'accept', ctx));
    expect(acc.request.status).toBe('accepted');
    expect(balance(acc.state, 'acc_main')).toBe(102_400);
    expect(resolveRequest(acc.state, req.request.id, 'cancel', ctx)).toMatchObject({ ok: false, error: 'request_not_pending' });
    const req2 = ok(createRequest(acc.state, { party: { name: 'Ava' }, amount: 999, accountId: 'acc_main' }, ctx));
    const can = ok(resolveRequest(req2.state, req2.request.id, 'cancel', ctx));
    expect(can.request.status).toBe('canceled');
    expect(balance(can.state, 'acc_main')).toBe(102_400);
    expectConsistent(can.state);
  });

  it('incoming request: pay debits (with funds check), decline does not', () => {
    const { state, ctx } = fixture();
    const req = ok(createRequest(state, { party: { name: 'Elif' }, amount: 3_500, accountId: 'acc_main', direction: 'incoming' }, ctx));
    expect(resolveRequest(req.state, req.request.id, 'accept', ctx)).toMatchObject({ ok: false, error: 'invalid_input' });
    const paid = ok(resolveRequest(req.state, req.request.id, 'pay', ctx));
    expect(paid.request.status).toBe('paid');
    expect(balance(paid.state, 'acc_main')).toBe(96_500);
    const big = ok(createRequest(paid.state, { party: { name: 'Elif' }, amount: 9_999_999, accountId: 'acc_main', direction: 'incoming' }, ctx));
    expect(resolveRequest(big.state, big.request.id, 'pay', ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    const declined = ok(resolveRequest(big.state, big.request.id, 'decline', ctx));
    expect(declined.request.status).toBe('declined');
    expectConsistent(declined.state);
  });
});

describe('manual balance changes', () => {
  it('logs every manual change as an adjustment', () => {
    const { state, ctx } = fixture();
    const set = ok(adjustBalance(state, { accountId: 'acc_main', mode: 'set', amount: 123_456 }, ctx));
    expect(balance(set.state, 'acc_main')).toBe(123_456);
    expect(set.txn?.type).toBe('adjustment');
    expect(set.txn?.direction).toBe('in');
    expect(set.txn?.amount).toBe(23_456);
    const rem = ok(adjustBalance(set.state, { accountId: 'acc_main', mode: 'remove', amount: 456 }, ctx));
    expect(balance(rem.state, 'acc_main')).toBe(123_000);
    const same = ok(adjustBalance(rem.state, { accountId: 'acc_main', mode: 'set', amount: 123_000 }, ctx));
    expect(same.txn).toBeNull();
    expect(adjustBalance(rem.state, { accountId: 'acc_main', mode: 'remove', amount: 999_999_999 }, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    expect(adjustBalance(rem.state, { accountId: 'acc_main', mode: 'set', amount: -1 }, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    expectConsistent(rem.state);
  });

  it('keeps credit balances within [−limit, 0]', () => {
    const { state, ctx } = fixture();
    expect(adjustBalance(state, { accountId: 'acc_credit', mode: 'set', amount: 100 }, ctx)).toMatchObject({ ok: false });
    expect(adjustBalance(state, { accountId: 'acc_credit', mode: 'set', amount: -200_001 }, ctx)).toMatchObject({ ok: false, error: 'insufficient_credit' });
    expect(ok(adjustBalance(state, { accountId: 'acc_credit', mode: 'set', amount: -50_000 }, ctx)).state.accounts.find((a) => a.id === 'acc_credit')?.balance).toBe(-50_000);
  });
});

describe('transfers', () => {
  it('conserves money between own accounts', () => {
    const { state, ctx } = fixture();
    const before = balance(state, 'acc_main') + balance(state, 'acc_savings');
    const r = ok(transfer(state, { fromId: 'acc_main', toId: 'acc_savings', amount: 12_345 }, ctx));
    expect(balance(r.state, 'acc_main') + balance(r.state, 'acc_savings')).toBe(before);
    expect(r.txn.toBalanceAfter).toBe(12_345);
    expectConsistent(r.state);
  });

  it('refuses mixed currencies, same account and overdrafts', () => {
    const { state, ctx } = fixture();
    expect(transfer(state, { fromId: 'acc_main', toId: 'acc_eur', amount: 100 }, ctx)).toMatchObject({ ok: false, error: 'currency_mismatch' });
    expect(transfer(state, { fromId: 'acc_main', toId: 'acc_main', amount: 100 }, ctx)).toMatchObject({ ok: false, error: 'same_account' });
    expect(transfer(state, { fromId: 'acc_savings', toId: 'acc_main', amount: 1 }, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
    expect(transfer(state, { fromId: 'acc_credit', toId: 'acc_main', amount: 1 }, ctx)).toMatchObject({ ok: false, error: 'invalid_input' });
  });

  it('pays down simulated credit, capped at the amount owed', () => {
    const { state, ctx } = fixture();
    expect(transfer(state, { fromId: 'acc_main', toId: 'acc_credit', amount: 30_001 }, ctx)).toMatchObject({ ok: false, error: 'invalid_amount' });
    const r = ok(transfer(state, { fromId: 'acc_main', toId: 'acc_credit', amount: 30_000 }, ctx));
    expect(r.txn.type).toBe('credit_payment');
    expect(balance(r.state, 'acc_credit')).toBe(0);
    expectConsistent(r.state);
  });
});

describe('currency exchange', () => {
  it('converts with the shown rate, charges the fee in the source currency', () => {
    const { state, ctx } = fixture();
    const rate = crossRate(DEMO_RATES, 'USD', 'EUR');
    expect(rate).toBe('0.86');
    const r = ok(exchange(state, { fromId: 'acc_main', toId: 'acc_eur', amount: 10_000, rate, rateSource: 'demo', rateTimestamp: DEMO_RATES.publishedAt }, ctx));
    expect(r.quote.fee).toBe(50); // 0.5 %
    expect(r.quote.converted).toBe(8_600);
    expect(balance(r.state, 'acc_main')).toBe(100_000 - 10_050);
    expect(balance(r.state, 'acc_eur')).toBe(20_000 + 8_600);
    expect(r.txn.fx?.rateSource).toBe('demo');
    expectConsistent(r.state);
  });

  it('handles zero-decimal currencies and rejects bad rates', () => {
    const { state, ctx } = fixture();
    const rate = crossRate(DEMO_RATES, 'USD', 'JPY');
    const r = ok(exchange(state, { fromId: 'acc_main', toId: 'acc_jpy', amount: 10_000, rate, rateSource: 'demo', rateTimestamp: DEMO_RATES.publishedAt }, ctx));
    expect(balance(r.state, 'acc_jpy')).toBe(14_750);
    expect(exchange(state, { fromId: 'acc_main', toId: 'acc_eur', amount: 100, rate: null, rateSource: 'demo', rateTimestamp: '' }, ctx)).toMatchObject({ ok: false, error: 'missing_rate' });
    expect(exchange(state, { fromId: 'acc_main', toId: 'acc_eur', amount: 100, rate: '-1', rateSource: 'demo', rateTimestamp: '' }, ctx)).toMatchObject({ ok: false, error: 'invalid_rate' });
    expect(exchange(state, { fromId: 'acc_main', toId: 'acc_checking', amount: 100, rate: '1', rateSource: 'demo', rateTimestamp: '' }, ctx)).toMatchObject({ ok: false, error: 'currency_mismatch' });
    expect(exchange(state, { fromId: 'acc_main', toId: 'acc_jpy', amount: 1, rate: '0.001', rateSource: 'demo', rateTimestamp: '' }, ctx)).toMatchObject({ ok: false, error: 'amount_too_small' });
  });
});

describe('card purchases', () => {
  it('charges the linked account and respects freeze and limits', () => {
    const { state, ctx } = fixture();
    const card = state.cards[0];
    const r = ok(purchase(state, { cardId: card.id, merchant: 'Green Basket Market', amount: 4_210, category: 'food' }, ctx));
    expect(balance(r.state, 'acc_main')).toBe(95_790);
    expect(r.txn.cardId).toBe(card.id);
    const frozen = { ...r.state, cards: r.state.cards.map((c) => (c.id === card.id ? { ...c, status: 'frozen' as const } : c)) };
    expect(purchase(frozen, { cardId: card.id, merchant: 'X', amount: 100, category: 'food' }, ctx)).toMatchObject({ ok: false, error: 'card_frozen' });
    const limited = { ...r.state, cards: r.state.cards.map((c) => (c.id === card.id ? { ...c, spendLimit: 5_000 } : c)) };
    expect(purchase(limited, { cardId: card.id, merchant: 'X', amount: 800, category: 'food' }, ctx)).toMatchObject({ ok: false, error: 'card_limit_exceeded' });
    expect(purchase(limited, { cardId: card.id, merchant: 'X', amount: 790, category: 'food' }, ctx).ok).toBe(true);
  });

  it('credit cards draw on available credit', () => {
    const { state, ctx } = fixture();
    const credit = state.cards[1];
    expect(purchase(state, { cardId: credit.id, merchant: 'Atlas Air (demo)', amount: 170_001, category: 'travel' }, ctx)).toMatchObject({ ok: false, error: 'insufficient_credit' });
    const r = ok(purchase(state, { cardId: credit.id, merchant: 'Atlas Air (demo)', amount: 170_000, category: 'travel' }, ctx));
    expect(balance(r.state, 'acc_credit')).toBe(-200_000);
    expectConsistent(r.state);
  });
});

describe('reversal and deletion keep accounting consistent', () => {
  it('reverses each kind of entry back to the original balances', () => {
    const { state, ctx } = fixture();
    let s = state;
    const start = s.accounts.map((a) => [a.id, a.balance] as const);
    const ids: string[] = [];
    const push = (r: { ok: boolean } & Record<string, unknown>) => {
      const rr = r as unknown as { ok: true; state: typeof s; txn: { id: string } };
      if (!rr.ok) throw new Error('op failed');
      s = rr.state;
      ids.push(rr.txn.id);
    };
    push(sendMoney(s, { recipient: { name: 'A' }, amount: 1_000, accountId: 'acc_main', instant: true }, ctx));
    push(receiveMoney(s, { from: { name: 'B' }, amount: 2_000, accountId: 'acc_main' }, ctx));
    push(purchase(s, { cardId: s.cards[0].id, merchant: 'Shop', amount: 3_000, category: 'shopping' }, ctx));
    push(transfer(s, { fromId: 'acc_main', toId: 'acc_savings', amount: 4_000 }, ctx));
    push(transfer(s, { fromId: 'acc_checking', toId: 'acc_credit', amount: 5_000 }, ctx));
    push(exchange(s, { fromId: 'acc_main', toId: 'acc_eur', amount: 6_000, rate: '0.86', rateSource: 'demo', rateTimestamp: DEMO_RATES.publishedAt }, ctx));
    const adj = ok(adjustBalance(s, { accountId: 'acc_main', mode: 'add', amount: 700 }, ctx));
    s = adj.state;
    ids.push(adj.txn!.id);
    for (const id of ids) s = ok(reverseTxn(s, id, ctx)).state;
    for (const [id, bal] of start) expect(balance(s, id)).toBe(bal);
    expectConsistent(s);
    // Reversed pairs can then be removed without changing balances.
    for (const id of ids) s = ok(deleteTxn(s, id, ctx)).state;
    for (const [id, bal] of start) expect(balance(s, id)).toBe(bal);
    expectConsistent(s);
  });

  it('refuses unsafe reversals and deletions', () => {
    const { state, ctx } = fixture();
    const sent = ok(sendMoney(state, { recipient: { name: 'A' }, amount: 1_000, accountId: 'acc_main' }, ctx));
    expect(deleteTxn(sent.state, sent.txn.id, ctx)).toMatchObject({ ok: false, error: 'reverse_first' });
    const opening = state.transactions.find((t) => t.subtype === 'opening')!;
    expect(reverseTxn(state, opening.id, ctx)).toMatchObject({ ok: false, error: 'txn_not_reversible' });
    const rev = ok(reverseTxn(sent.state, sent.txn.id, ctx));
    expect(reverseTxn(rev.state, sent.txn.id, ctx)).toMatchObject({ ok: false, error: 'txn_not_reversible' });
    expect(reverseTxn(rev.state, rev.txn.id, ctx)).toMatchObject({ ok: false, error: 'txn_not_reversible' });
    // A received payment that was already spent cannot be reversed into overdraft.
    const got = ok(receiveMoney(state, { from: { name: 'B' }, amount: 5_000, accountId: 'acc_savings' }, ctx));
    const spent = ok(transfer(got.state, { fromId: 'acc_savings', toId: 'acc_main', amount: 5_000 }, ctx));
    expect(reverseTxn(spent.state, got.txn.id, ctx)).toMatchObject({ ok: false, error: 'insufficient_funds' });
  });

  it('deletes unapplied entries directly and cancels their request', () => {
    const { state, ctx } = fixture();
    const req = ok(createRequest(state, { party: { name: 'Ava' }, amount: 2_400, accountId: 'acc_main' }, ctx));
    const del = ok(deleteTxn(req.state, req.txn.id, ctx));
    expect(del.removed).toEqual([req.txn.id]);
    expect(del.state.requests[0].status).toBe('canceled');
    expectConsistent(del.state);
  });

  it('edits only descriptive fields', () => {
    const { state, ctx } = fixture();
    const sent = ok(sendMoney(state, { recipient: { name: 'A' }, amount: 1_000, accountId: 'acc_main' }, ctx));
    const upd = ok(updateTxnDetails(sent.state, sent.txn.id, { note: 'Edited ✏️', category: 'food', tags: ['#Trip', 'trip', ' work '] }));
    expect(upd.txn.note).toBe('Edited ✏️');
    expect(upd.txn.tags).toEqual(['trip', 'work']);
    expect(upd.txn.amount).toBe(1_000);
    expectConsistent(upd.state);
  });
});

describe('time-sensitive ids', () => {
  it('uses the injected clock', () => {
    const { state } = fixture();
    const r = ok(sendMoney(state, { recipient: { name: 'A' }, amount: 100, accountId: 'acc_main' }, ctxAt('2026-01-02T03:04:05Z')));
    expect(r.txn.createdAt).toBe('2026-01-02T03:04:05.000Z');
  });
});
