import type { Category, RequestStatus, Txn, TxnStatus, TxnType } from './types';

export const CATEGORIES: Category[] = [
  'food',
  'transport',
  'shopping',
  'bills',
  'entertainment',
  'travel',
  'health',
  'subscriptions',
  'transfers',
  'income',
  'investing',
  'other',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  food: 'Food & drink',
  transport: 'Transport',
  shopping: 'Shopping',
  bills: 'Bills & utilities',
  entertainment: 'Entertainment',
  travel: 'Travel',
  health: 'Health',
  subscriptions: 'Subscriptions',
  transfers: 'Transfers',
  income: 'Income',
  investing: 'Investing',
  other: 'Other',
};

export const TXN_TYPES: TxnType[] = [
  'send',
  'receive',
  'purchase',
  'refund',
  'transfer',
  'exchange',
  'adjustment',
  'invest_buy',
  'invest_sell',
  'fee',
  'credit_payment',
];

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  send: 'Sent',
  receive: 'Received',
  adjustment: 'Adjustment',
  purchase: 'Card purchase',
  refund: 'Refund',
  transfer: 'Transfer',
  exchange: 'Exchange',
  invest_buy: 'Investment buy',
  invest_sell: 'Investment sell',
  fee: 'Fee',
  credit_payment: 'Credit payment',
};

export const STATUS_LABEL: Record<TxnStatus, string> = {
  completed: 'Simulation completed',
  pending: 'Simulation pending',
  canceled: 'Simulation canceled',
  reversed: 'Simulation reversed',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  canceled: 'Canceled',
  paid: 'Paid',
};

/** Short status for list rows; null when nothing needs calling out. */
export function rowStatus(t: Txn): string | null {
  if (t.status === 'pending') return 'Pending';
  if (t.status === 'canceled') return 'Canceled';
  if (t.status === 'reversed') return 'Reversed';
  if (t.untracked) return 'Not applied';
  return null;
}

export function txnTypeLabel(t: Txn): string {
  if (t.type === 'adjustment') {
    if (t.subtype === 'opening') return 'Opening balance';
    if (t.subtype === 'reversal') return 'Reversal';
    return 'Balance adjustment';
  }
  if (t.subtype === 'request') return t.type === 'receive' ? 'Request' : 'Request to pay';
  if (t.subtype === 'subscription') return 'Subscription';
  if (t.subtype === 'bill') return 'Bill payment';
  if (t.subtype === 'goal') return 'Goal transfer';
  if (t.subtype === 'reversal') return `${TXN_TYPE_LABEL[t.type]} reversal`;
  return TXN_TYPE_LABEL[t.type];
}
