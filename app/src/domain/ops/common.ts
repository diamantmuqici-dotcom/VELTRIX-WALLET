import { CURRENCIES, type CurrencyCode } from '../currency';
import { formatMoney, MAX_OPERATION_MAJOR, pow10 } from '../money';
import type { AccountKind, AppState, OpContext, OpError, Txn } from '../types';

export const MAIN_ACCOUNT_ID = 'acc_main';

/** Account kinds that can send or receive person-to-person simulated payments. */
export const PAYMENT_KINDS: AccountKind[] = ['wallet', 'checking', 'savings', 'card', 'foreign'];

export function fail(error: OpError, detail?: string): { ok: false; error: OpError; detail?: string } {
  return { ok: false, error, detail };
}

export function isValidAmount(minor: unknown, currency: CurrencyCode): minor is number {
  return (
    typeof minor === 'number' &&
    Number.isSafeInteger(minor) &&
    minor > 0 &&
    minor <= MAX_OPERATION_MAJOR * pow10(CURRENCIES[currency].decimals)
  );
}

type TxnDraft = Omit<Txn, 'id' | 'createdAt' | 'tags' | 'fee' | 'applied' | 'status'> &
  Partial<Pick<Txn, 'tags' | 'fee' | 'applied' | 'status' | 'createdAt'>>;

export function newTxn(ctx: OpContext, draft: TxnDraft): Txn {
  return {
    id: ctx.id('txn'),
    createdAt: ctx.now.toISOString(),
    tags: [],
    fee: 0,
    applied: true,
    status: 'completed',
    ...draft,
  };
}

export function money(state: AppState, minor: number, currency: CurrencyCode): string {
  return formatMoney(minor, currency, { locale: state.settings.numberLocale });
}

export function lastTxn(state: AppState): Txn {
  return state.transactions[state.transactions.length - 1];
}
