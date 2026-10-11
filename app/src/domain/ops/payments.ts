import Big from 'big.js';
import { CURRENCIES } from '../currency';
import { monthKeyOf } from '../dates';
import {
  applyExisting,
  cardSpend,
  checkDebit,
  findProcessedOp,
  patchTxn,
  postTxn,
  pushNotification,
  recordOp,
  requireAccount,
  txnEffects,
} from '../ledger';
import { computeFee, convertMinor, MAX_BALANCE_MINOR } from '../money';
import type { AppState, Category, OpContext, OpResult, PaymentRequest, RateSourceKind, Txn, TxnSubtype } from '../types';
import { cleanText, graphemeLength, NOTE_MAX, TITLE_MAX, truncateGraphemes } from '../validation';
import { fail, isValidAmount, lastTxn, money, newTxn, PAYMENT_KINDS } from './common';

export interface Party {
  contactId?: string;
  name: string;
  handle?: string;
}

function cleanParty(p: Party | null | undefined): Party | null {
  if (!p) return null;
  const name = truncateGraphemes(cleanText(p.name), TITLE_MAX);
  if (!name) return null;
  const handle = p.handle ? cleanText(p.handle).replace(/^@+/, '') : undefined;
  return { contactId: p.contactId, name, handle: handle || undefined };
}

function cleanNote(note: string | undefined): string | null {
  const n = cleanText(note ?? '');
  if (graphemeLength(n) > NOTE_MAX) return null;
  return n;
}

function duplicateTxn(state: AppState, opKey?: string): Txn | null {
  const id = findProcessedOp(state, opKey);
  if (!id) return null;
  return state.transactions.find((t) => t.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Send                                                                */
/* ------------------------------------------------------------------ */

export interface SendInput {
  recipient: Party | null;
  amount: number;
  accountId: string;
  note?: string;
  category?: Category;
  instant?: boolean;
  outcome?: 'completed' | 'pending';
  opKey?: string;
}

export function sendFeeFor(state: AppState, amount: number, instant: boolean): number {
  return instant ? computeFee(amount, state.settings.fees.instantSend) : 0;
}

export function sendMoney(state: AppState, input: SendInput, ctx: OpContext): OpResult<{ txn: Txn }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const party = cleanParty(input.recipient);
  if (!party) return fail('missing_recipient');
  if (party.contactId && !state.contacts.some((c) => c.id === party.contactId)) return fail('contact_not_found');
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  if (!PAYMENT_KINDS.includes(acc.kind)) return fail('invalid_input', 'Choose a wallet, checking, savings, card or currency account.');
  if (input.amount === undefined || input.amount === null || input.amount === 0) return fail('missing_amount');
  if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const tracked = state.settings.trackBalances;
  const outcome = input.outcome ?? 'completed';
  const fee = sendFeeFor(state, input.amount, !!input.instant);
  if (outcome === 'completed') {
    const e = checkDebit(state, acc, input.amount + fee, tracked);
    if (e) return fail(e);
  }
  const txn = newTxn(ctx, {
    type: 'send',
    title: party.name,
    counterparty: party,
    amount: input.amount,
    fee,
    currency: acc.currency,
    direction: 'out',
    accountId: acc.id,
    note: note || undefined,
    category: input.category ?? 'transfers',
    status: outcome,
    applied: outcome === 'completed' && tracked,
    untracked: tracked ? undefined : true,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  next = pushNotification(
    next,
    ctx,
    'payment',
    outcome === 'completed' ? 'Simulation completed' : 'Simulation pending',
    `${money(state, input.amount, acc.currency)} to ${party.name} (simulated)`,
    { screen: 'txn', params: { id: txn.id } },
  );
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

function lastOf(state: AppState, id: string): Txn {
  const t = lastTxn(state);
  return t.id === id ? t : (state.transactions.find((x) => x.id === id) as Txn);
}

/* ------------------------------------------------------------------ */
/* Receive (simulated incoming payment)                                */
/* ------------------------------------------------------------------ */

export interface ReceiveInput {
  from: Party | null;
  amount: number;
  accountId: string;
  note?: string;
  category?: Category;
  opKey?: string;
}

export function receiveMoney(state: AppState, input: ReceiveInput, ctx: OpContext): OpResult<{ txn: Txn }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const party = cleanParty(input.from);
  if (!party) return fail('missing_recipient', 'Enter who the simulated payment is from.');
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  if (!PAYMENT_KINDS.includes(acc.kind)) return fail('invalid_input', 'Choose a wallet, checking, savings, card or currency account.');
  if (!input.amount) return fail('missing_amount');
  if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
  if (acc.balance + input.amount > MAX_BALANCE_MINOR) return fail('balance_out_of_range');
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const tracked = state.settings.trackBalances;
  const txn = newTxn(ctx, {
    type: 'receive',
    title: party.name,
    counterparty: party,
    amount: input.amount,
    currency: acc.currency,
    direction: 'in',
    accountId: acc.id,
    note: note || undefined,
    category: input.category ?? 'income',
    applied: tracked,
    untracked: tracked ? undefined : true,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  next = pushNotification(next, ctx, 'payment', 'Simulated payment received', `${money(state, input.amount, acc.currency)} from ${party.name}`, {
    screen: 'txn',
    params: { id: txn.id },
  });
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

/* ------------------------------------------------------------------ */
/* Pending simulations                                                 */
/* ------------------------------------------------------------------ */

export function completePending(state: AppState, txnId: string, ctx: OpContext): OpResult<{ txn: Txn }> {
  const t = state.transactions.find((x) => x.id === txnId);
  if (!t) return fail('txn_not_found');
  if (t.status !== 'pending') return fail('txn_not_pending');
  const acc = requireAccount(state, t.accountId);
  if (typeof acc === 'string') return fail(acc);
  const tracked = state.settings.trackBalances;
  if (t.direction !== 'in') {
    const e = checkDebit(state, acc, t.amount + t.fee, tracked);
    if (e) return fail(e);
  }
  let next = applyExisting(state, txnId, { status: 'completed', applied: tracked, untracked: tracked ? undefined : true });
  const reqId = t.links?.requestId;
  if (reqId) {
    next = {
      ...next,
      requests: next.requests.map((r) =>
        r.id === reqId ? { ...r, status: r.direction === 'outgoing' ? 'accepted' : 'paid', resolvedAt: ctx.now.toISOString() } : r,
      ),
    };
  }
  return { ok: true, state: next, txn: next.transactions.find((x) => x.id === txnId) as Txn };
}

export function cancelPending(state: AppState, txnId: string, ctx: OpContext): OpResult<{ txn: Txn }> {
  const t = state.transactions.find((x) => x.id === txnId);
  if (!t) return fail('txn_not_found');
  if (t.status !== 'pending') return fail('txn_not_pending');
  let next = patchTxn(state, txnId, { status: 'canceled', applied: false });
  const reqId = t.links?.requestId;
  if (reqId) {
    next = {
      ...next,
      requests: next.requests.map((r) =>
        r.id === reqId ? { ...r, status: r.direction === 'outgoing' ? 'canceled' : 'declined', resolvedAt: ctx.now.toISOString() } : r,
      ),
    };
  }
  return { ok: true, state: next, txn: next.transactions.find((x) => x.id === txnId) as Txn };
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

export interface RequestInput {
  party: Party | null;
  amount: number;
  /** outgoing: account that will receive; incoming: account that will pay. */
  accountId: string;
  note?: string;
  direction?: 'outgoing' | 'incoming';
  opKey?: string;
}

export function createRequest(state: AppState, input: RequestInput, ctx: OpContext): OpResult<{ request: PaymentRequest; txn: Txn }> {
  const dupId = findProcessedOp(state, input.opKey);
  if (dupId) {
    const request = state.requests.find((r) => r.id === dupId);
    const txn = request?.txnId ? state.transactions.find((t) => t.id === request.txnId) : undefined;
    if (request && txn) return { ok: true, state, duplicate: true, request, txn };
  }
  const party = cleanParty(input.party);
  if (!party) return fail('missing_recipient');
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  if (!PAYMENT_KINDS.includes(acc.kind)) return fail('invalid_input', 'Choose a wallet, checking, savings, card or currency account.');
  if (!input.amount) return fail('missing_amount');
  if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const direction = input.direction ?? 'outgoing';
  const requestId = ctx.id('req');
  const txn = newTxn(ctx, {
    type: direction === 'outgoing' ? 'receive' : 'send',
    subtype: 'request',
    title: party.name,
    counterparty: party,
    amount: input.amount,
    currency: acc.currency,
    direction: direction === 'outgoing' ? 'in' : 'out',
    accountId: acc.id,
    note: note || undefined,
    category: direction === 'outgoing' ? 'income' : 'transfers',
    status: 'pending',
    applied: false,
    links: { requestId },
  });
  const request: PaymentRequest = {
    id: requestId,
    direction,
    contactId: party.contactId,
    name: party.name,
    handle: party.handle,
    amount: input.amount,
    currency: acc.currency,
    note,
    status: 'pending',
    accountId: acc.id,
    createdAt: ctx.now.toISOString(),
    txnId: txn.id,
  };
  let next = postTxn(state, txn);
  next = { ...next, requests: [request, ...next.requests] };
  next = recordOp(next, input.opKey, requestId);
  next = pushNotification(
    next,
    ctx,
    'request',
    direction === 'outgoing' ? 'Simulated request saved' : 'New simulated request',
    direction === 'outgoing'
      ? `You requested ${money(state, input.amount, acc.currency)} from ${party.name}`
      : `${party.name} requested ${money(state, input.amount, acc.currency)} (simulated)`,
    { screen: 'requests' },
  );
  return { ok: true, state: next, request, txn: lastOf(next, txn.id) };
}

export type RequestAction = 'accept' | 'cancel' | 'pay' | 'decline';

export function resolveRequest(state: AppState, requestId: string, action: RequestAction, ctx: OpContext): OpResult<{ request: PaymentRequest }> {
  const req = state.requests.find((r) => r.id === requestId);
  if (!req) return fail('request_not_found');
  if (req.status !== 'pending') return fail('request_not_pending');
  const valid =
    (req.direction === 'outgoing' && (action === 'accept' || action === 'cancel')) ||
    (req.direction === 'incoming' && (action === 'pay' || action === 'decline'));
  if (!valid) return fail('invalid_input');
  if (!req.txnId) return fail('txn_not_found');
  const r = action === 'accept' || action === 'pay' ? completePending(state, req.txnId, ctx) : cancelPending(state, req.txnId, ctx);
  if (!r.ok) return r;
  const request = r.state.requests.find((x) => x.id === requestId) as PaymentRequest;
  let next = r.state;
  if (action === 'accept') {
    next = pushNotification(next, ctx, 'request', 'Request accepted (simulated)', `${req.name} paid ${money(state, req.amount, req.currency)}`, {
      screen: 'txn',
      params: { id: req.txnId },
    });
  }
  return { ok: true, state: next, request };
}

/* ------------------------------------------------------------------ */
/* Manual balance adjustments                                          */
/* ------------------------------------------------------------------ */

export interface AdjustInput {
  accountId: string;
  mode: 'add' | 'remove' | 'set';
  /** add/remove: positive minor units. set: target balance (signed minor units). */
  amount: number;
  note?: string;
  subtype?: TxnSubtype;
  title?: string;
  opKey?: string;
}

export function adjustBalance(state: AppState, input: AdjustInput, ctx: OpContext): OpResult<{ txn: Txn | null }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  let delta: number;
  if (input.mode === 'set') {
    if (!Number.isSafeInteger(input.amount)) return fail('invalid_amount');
    delta = input.amount - acc.balance;
  } else {
    if (!input.amount) return fail('missing_amount');
    if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
    delta = input.mode === 'add' ? input.amount : -input.amount;
  }
  if (delta === 0) return { ok: true, state, txn: null };
  const after = acc.balance + delta;
  if (Math.abs(after) > MAX_BALANCE_MINOR) return fail('balance_out_of_range');
  if (acc.kind === 'credit') {
    const limit = acc.credit?.limit ?? 0;
    if (after > 0) return fail('balance_out_of_range', 'A credit account cannot hold a positive balance in the simulator.');
    if (-after > limit) return fail('insufficient_credit');
  } else if (after < 0) {
    return fail('insufficient_funds');
  }
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const title =
    input.title ??
    (input.mode === 'add' ? 'Simulated funds added' : input.mode === 'remove' ? 'Simulated funds removed' : `Balance edited to ${money(state, input.amount, acc.currency)}`);
  const txn = newTxn(ctx, {
    type: 'adjustment',
    subtype: input.subtype ?? 'manual',
    title,
    amount: Math.abs(delta),
    currency: acc.currency,
    direction: delta > 0 ? 'in' : 'out',
    accountId: acc.id,
    note: note || undefined,
    category: 'other',
    applied: true,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

/* ------------------------------------------------------------------ */
/* Transfers between own accounts                                      */
/* ------------------------------------------------------------------ */

export interface TransferInput {
  fromId: string;
  toId: string;
  amount: number;
  note?: string;
  subtype?: TxnSubtype;
  goalId?: string;
  opKey?: string;
}

export function transfer(state: AppState, input: TransferInput, ctx: OpContext): OpResult<{ txn: Txn }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const from = requireAccount(state, input.fromId);
  if (typeof from === 'string') return fail(from);
  const to = requireAccount(state, input.toId);
  if (typeof to === 'string') return fail(to);
  if (from.id === to.id) return fail('same_account');
  if (from.currency !== to.currency) return fail('currency_mismatch', 'Use Exchange to move money between currencies.');
  if (from.kind === 'credit') return fail('invalid_input', 'Transfers out of a credit account are not simulated.');
  if (!input.amount) return fail('missing_amount');
  if (!isValidAmount(input.amount, from.currency)) return fail('invalid_amount');
  const tracked = state.settings.trackBalances;
  const isCreditPayment = to.kind === 'credit';
  if (isCreditPayment && tracked && input.amount > -to.balance) {
    return fail('invalid_amount', `The simulated amount owed is ${money(state, Math.max(0, -to.balance), to.currency)}.`);
  }
  const e = checkDebit(state, from, input.amount, tracked);
  if (e) return fail(e);
  if (tracked && to.balance + input.amount > MAX_BALANCE_MINOR) return fail('balance_out_of_range');
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const txn = newTxn(ctx, {
    type: isCreditPayment ? 'credit_payment' : 'transfer',
    subtype: input.subtype,
    title: isCreditPayment ? `Payment to ${to.name}` : `${from.name} → ${to.name}`,
    amount: input.amount,
    currency: from.currency,
    direction: 'internal',
    accountId: from.id,
    toAccountId: to.id,
    note: note || undefined,
    category: 'transfers',
    applied: tracked,
    untracked: tracked ? undefined : true,
    links: input.goalId ? { goalId: input.goalId } : undefined,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

/* ------------------------------------------------------------------ */
/* Currency exchange                                                   */
/* ------------------------------------------------------------------ */

export interface ExchangeInput {
  fromId: string;
  toId: string;
  /** amount in the source currency (minor units), excluding fee */
  amount: number;
  /** units of target per 1 unit of source */
  rate: string | null;
  rateSource: RateSourceKind;
  rateTimestamp: string;
  /** Charge the configured simulated exchange fee (default true). */
  withFee?: boolean;
  opKey?: string;
}

export interface ExchangeQuote {
  amount: number;
  fee: number;
  totalDebit: number;
  converted: number;
  rate: string;
}

export function quoteExchange(
  state: AppState,
  fromCurrency: keyof typeof CURRENCIES,
  toCurrency: keyof typeof CURRENCIES,
  amount: number,
  rate: string | null,
  withFee = true,
): ExchangeQuote | { error: 'missing_rate' | 'invalid_rate' | 'amount_too_small' | 'invalid_amount' } {
  if (rate === null || rate === undefined || rate === '') return { error: 'missing_rate' };
  let r: Big;
  try {
    r = new Big(rate);
  } catch {
    return { error: 'invalid_rate' };
  }
  if (r.lte(0)) return { error: 'invalid_rate' };
  if (!isValidAmount(amount, fromCurrency)) return { error: 'invalid_amount' };
  const fee = withFee ? computeFee(amount, state.settings.fees.exchange) : 0;
  const converted = convertMinor(amount, CURRENCIES[fromCurrency].decimals, CURRENCIES[toCurrency].decimals, rate);
  if (converted <= 0) return { error: 'amount_too_small' };
  return { amount, fee, totalDebit: amount + fee, converted, rate: r.toString() };
}

export function exchange(state: AppState, input: ExchangeInput, ctx: OpContext): OpResult<{ txn: Txn; quote: ExchangeQuote }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup && dup.fx) {
    return { ok: true, state, duplicate: true, txn: dup, quote: { amount: dup.amount, fee: dup.fee, totalDebit: dup.amount + dup.fee, converted: dup.fx.targetAmount, rate: dup.fx.rate } };
  }
  const from = requireAccount(state, input.fromId);
  if (typeof from === 'string') return fail(from);
  const to = requireAccount(state, input.toId);
  if (typeof to === 'string') return fail(to);
  if (from.id === to.id) return fail('same_account');
  if (from.currency === to.currency) return fail('currency_mismatch', 'Both accounts use the same currency — use Transfer instead.');
  if (from.kind === 'credit' || to.kind === 'credit') return fail('invalid_input', 'Exchanges with credit accounts are not simulated.');
  if (!input.amount) return fail('missing_amount');
  const q = quoteExchange(state, from.currency, to.currency, input.amount, input.rate, input.withFee !== false);
  if ('error' in q) return fail(q.error);
  const tracked = state.settings.trackBalances;
  const e = checkDebit(state, from, q.totalDebit, tracked);
  if (e) return fail(e);
  if (tracked && to.balance + q.converted > MAX_BALANCE_MINOR) return fail('balance_out_of_range');
  const txn = newTxn(ctx, {
    type: 'exchange',
    title: `${from.currency} → ${to.currency}`,
    amount: q.amount,
    fee: q.fee,
    currency: from.currency,
    direction: 'internal',
    accountId: from.id,
    toAccountId: to.id,
    category: 'transfers',
    applied: tracked,
    untracked: tracked ? undefined : true,
    fx: {
      from: from.currency,
      to: to.currency,
      rate: q.rate,
      sourceAmount: q.amount,
      targetAmount: q.converted,
      rateSource: input.rateSource,
      rateTimestamp: input.rateTimestamp,
    },
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  return { ok: true, state: next, txn: lastOf(next, txn.id), quote: q };
}

/* ------------------------------------------------------------------ */
/* Card purchases                                                      */
/* ------------------------------------------------------------------ */

export interface PurchaseInput {
  cardId: string;
  merchant: string;
  amount: number;
  category: Category;
  note?: string;
  subtype?: TxnSubtype;
  opKey?: string;
}

export function purchase(state: AppState, input: PurchaseInput, ctx: OpContext): OpResult<{ txn: Txn }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const card = state.cards.find((c) => c.id === input.cardId);
  if (!card) return fail('card_not_found');
  if (card.status === 'frozen') return fail('card_frozen');
  const acc = requireAccount(state, card.accountId);
  if (typeof acc === 'string') return fail(acc);
  const merchant = truncateGraphemes(cleanText(input.merchant), TITLE_MAX);
  if (!merchant) return fail('missing_recipient', 'Enter a fictional merchant name.');
  if (!input.amount) return fail('missing_amount');
  if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
  if (card.spendLimit > 0) {
    const spent = cardSpend(state, card.id, monthKeyOf(ctx.now));
    if (spent + input.amount > card.spendLimit) return fail('card_limit_exceeded');
  }
  const tracked = state.settings.trackBalances;
  const e = checkDebit(state, acc, input.amount, tracked);
  if (e) return fail(e);
  const note = cleanNote(input.note);
  if (note === null) return fail('note_too_long');
  const txn = newTxn(ctx, {
    type: 'purchase',
    subtype: input.subtype,
    title: merchant,
    amount: input.amount,
    currency: acc.currency,
    direction: 'out',
    accountId: acc.id,
    cardId: card.id,
    note: note || undefined,
    category: input.category,
    applied: tracked,
    untracked: tracked ? undefined : true,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  if (card.spendLimit > 0) {
    const spent = cardSpend(next, card.id, monthKeyOf(ctx.now));
    if (spent >= card.spendLimit * 0.9) {
      next = pushNotification(next, ctx, 'budget', 'Card limit almost reached', `${card.nickname} has used ${Math.round((spent / card.spendLimit) * 100)}% of its demo monthly limit.`, {
        screen: 'card',
        params: { id: card.id },
      });
    }
  }
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

/* ------------------------------------------------------------------ */
/* Simulated fees                                                      */
/* ------------------------------------------------------------------ */

export function chargeFee(state: AppState, input: { accountId: string; amount: number; title: string; opKey?: string }, ctx: OpContext): OpResult<{ txn: Txn }> {
  const dup = duplicateTxn(state, input.opKey);
  if (dup) return { ok: true, state, duplicate: true, txn: dup };
  const acc = requireAccount(state, input.accountId);
  if (typeof acc === 'string') return fail(acc);
  if (!isValidAmount(input.amount, acc.currency)) return fail('invalid_amount');
  const tracked = state.settings.trackBalances;
  const e = checkDebit(state, acc, input.amount, tracked);
  if (e) return fail(e);
  const txn = newTxn(ctx, {
    type: 'fee',
    title: cleanText(input.title) || 'Simulated fee',
    amount: input.amount,
    currency: acc.currency,
    direction: 'out',
    accountId: acc.id,
    category: 'bills',
    applied: tracked,
    untracked: tracked ? undefined : true,
  });
  let next = postTxn(state, txn);
  next = recordOp(next, input.opKey, txn.id);
  return { ok: true, state: next, txn: lastOf(next, txn.id) };
}

/* ------------------------------------------------------------------ */
/* Reversal, deletion, editing                                         */
/* ------------------------------------------------------------------ */

export function canReverse(t: Txn): boolean {
  if (t.status !== 'completed' || !t.applied) return false;
  if (t.links?.reversedBy || t.links?.reversalOf) return false;
  if (t.subtype === 'opening' || t.subtype === 'starting') return false;
  if (t.type === 'invest_buy' || t.type === 'invest_sell') return false;
  return true;
}

export function reverseTxn(state: AppState, txnId: string, ctx: OpContext): OpResult<{ txn: Txn }> {
  const t = state.transactions.find((x) => x.id === txnId);
  if (!t) return fail('txn_not_found');
  if (!canReverse(t)) return fail('txn_not_reversible');
  const src = state.accounts.find((a) => a.id === t.accountId);
  if (!src) return fail('account_not_found');
  let draft: Omit<Txn, 'id' | 'createdAt' | 'tags' | 'fee' | 'applied' | 'status'> & { fee?: number };
  switch (t.type) {
    case 'send':
    case 'purchase':
    case 'fee':
      draft = {
        type: 'refund',
        title: `Refund · ${t.title}`,
        counterparty: t.counterparty,
        amount: t.amount + t.fee,
        currency: t.currency,
        direction: 'in',
        accountId: t.accountId,
        cardId: t.cardId,
        category: t.category,
      };
      break;
    case 'receive':
    case 'refund': {
      const amount = t.amount - t.fee;
      if (src.kind === 'credit') {
        if (-(src.balance - amount) > (src.credit?.limit ?? 0)) return fail('insufficient_credit');
      } else if (src.balance < amount) return fail('insufficient_funds');
      draft = {
        type: 'adjustment',
        subtype: 'reversal',
        title: `Reversal · ${t.title}`,
        counterparty: t.counterparty,
        amount,
        currency: t.currency,
        direction: 'out',
        accountId: t.accountId,
        cardId: t.cardId,
        category: t.category,
      };
      break;
    }
    case 'adjustment': {
      if (t.direction === 'in') {
        if (src.kind === 'credit') {
          if (-(src.balance - t.amount) > (src.credit?.limit ?? 0)) return fail('insufficient_credit');
        } else if (src.balance < t.amount) return fail('insufficient_funds');
      } else if (src.kind === 'credit' && src.balance + t.amount > 0) {
        return fail('balance_out_of_range');
      }
      draft = {
        type: 'adjustment',
        subtype: 'reversal',
        title: `Reversal · ${t.title}`,
        amount: t.amount,
        currency: t.currency,
        direction: t.direction === 'in' ? 'out' : 'in',
        accountId: t.accountId,
        category: t.category,
      };
      break;
    }
    case 'transfer':
    case 'credit_payment': {
      const dest = state.accounts.find((a) => a.id === t.toAccountId);
      if (!dest) return fail('account_not_found');
      if (dest.kind === 'credit') {
        if (-(dest.balance - t.amount) > (dest.credit?.limit ?? 0)) return fail('insufficient_credit');
      } else if (dest.balance < t.amount) return fail('insufficient_funds');
      draft = {
        type: t.type,
        subtype: 'reversal',
        title: `Reversal · ${t.title}`,
        amount: t.amount,
        currency: t.currency,
        direction: 'internal',
        accountId: dest.id,
        toAccountId: t.accountId,
        category: 'transfers',
      };
      break;
    }
    case 'exchange': {
      const dest = state.accounts.find((a) => a.id === t.toAccountId);
      if (!dest || !t.fx) return fail('txn_not_reversible');
      if (dest.balance < t.fx.targetAmount) return fail('insufficient_funds');
      const back = t.amount + t.fee;
      const rate = new Big(back)
        .div(10 ** CURRENCIES[t.fx.from].decimals)
        .div(new Big(t.fx.targetAmount).div(10 ** CURRENCIES[t.fx.to].decimals))
        .round(8, Big.roundHalfUp)
        .toString();
      draft = {
        type: 'exchange',
        subtype: 'reversal',
        title: `Reversal · ${t.fx.from} → ${t.fx.to}`,
        amount: t.fx.targetAmount,
        currency: t.fx.to,
        direction: 'internal',
        accountId: dest.id,
        toAccountId: t.accountId,
        category: 'transfers',
        fx: {
          from: t.fx.to,
          to: t.fx.from,
          rate,
          sourceAmount: t.fx.targetAmount,
          targetAmount: back,
          rateSource: t.fx.rateSource,
          rateTimestamp: t.fx.rateTimestamp,
        },
      };
      break;
    }
    default:
      return fail('txn_not_reversible');
  }
  const reversal = newTxn(ctx, { ...draft, applied: true, links: { reversalOf: t.id } });
  let next = postTxn(state, reversal);
  next = patchTxn(next, t.id, { status: 'reversed', links: { reversedBy: reversal.id } });
  return { ok: true, state: next, txn: lastOf(next, reversal.id) };
}

/**
 * Removes entries from the history without breaking accounting:
 *  - entries that never moved money (pending, canceled, untracked) are removed;
 *  - a reversed entry is removed together with its reversal (net effect zero);
 *  - applied entries must be reversed first.
 */
export function deleteTxn(state: AppState, txnId: string, ctx: OpContext): OpResult<{ removed: string[] }> {
  const t = state.transactions.find((x) => x.id === txnId);
  if (!t) return fail('txn_not_found');
  let removed: string[];
  if (!t.applied) {
    removed = [t.id];
  } else {
    const partnerId = t.links?.reversedBy ?? t.links?.reversalOf;
    const partner = partnerId ? state.transactions.find((x) => x.id === partnerId) : undefined;
    if (!partner) return fail('reverse_first');
    // Safety: the pair must net to zero on every account.
    const net = new Map<string, number>();
    for (const e of [...txnEffects(t), ...txnEffects(partner)]) net.set(e.accountId, (net.get(e.accountId) ?? 0) + e.delta);
    for (const v of net.values()) if (v !== 0) return fail('reverse_first');
    removed = [t.id, partner.id];
  }
  const removedSet = new Set(removed);
  let next: AppState = { ...state, transactions: state.transactions.filter((x) => !removedSet.has(x.id)) };
  if (t.links?.requestId && t.status === 'pending') {
    next = {
      ...next,
      requests: next.requests.map((r) => (r.id === t.links?.requestId ? { ...r, status: 'canceled', resolvedAt: ctx.now.toISOString(), txnId: undefined } : r)),
    };
  }
  // Clear dangling reversal links on remaining entries.
  next = {
    ...next,
    transactions: next.transactions.map((x) =>
      (x.links?.reversedBy && removedSet.has(x.links.reversedBy)) || (x.links?.reversalOf && removedSet.has(x.links.reversalOf))
        ? { ...x, links: { ...x.links, reversedBy: undefined, reversalOf: undefined }, status: x.status === 'reversed' ? 'completed' : x.status }
        : x,
    ),
  };
  return { ok: true, state: next, removed };
}

export interface TxnDetailsPatch {
  note?: string;
  category?: Category;
  tags?: string[];
}

/** Edits descriptive fields only — amounts and accounts are immutable history. */
export function updateTxnDetails(state: AppState, txnId: string, patch: TxnDetailsPatch): OpResult<{ txn: Txn }> {
  const t = state.transactions.find((x) => x.id === txnId);
  if (!t) return fail('txn_not_found');
  const upd: Partial<Txn> = {};
  if (patch.note !== undefined) {
    const n = cleanNote(patch.note);
    if (n === null) return fail('note_too_long');
    upd.note = n || undefined;
  }
  if (patch.category) upd.category = patch.category;
  if (patch.tags) {
    upd.tags = Array.from(new Set(patch.tags.map((x) => cleanText(x).toLowerCase().replace(/^#/, '')).filter((x) => x && x.length <= 24))).slice(0, 8);
  }
  const next = patchTxn(state, txnId, upd);
  return { ok: true, state: next, txn: next.transactions.find((x) => x.id === txnId) as Txn };
}
