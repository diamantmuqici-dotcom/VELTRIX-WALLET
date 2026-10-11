import { sequentialIds } from '../src/domain/ids';
import { verifyLedger } from '../src/domain/ledger';
import { createAccount, createCard, createContact, type CardInput } from '../src/domain/ops/entities';
import { baseState } from '../src/domain/presets';
import type { AppState, OpContext, OpResult } from '../src/domain/types';

export const T0 = new Date('2026-03-10T10:00:00');

/** One id sequence for every helper context, so ids never collide inside a test file. */
const sharedIds = sequentialIds('t');

export function ctxAt(date: Date | string = T0, ids = sharedIds): OpContext {
  return { now: typeof date === 'string' ? new Date(date) : date, id: ids };
}

/** Unwraps a successful op result or throws with the error code. */
export function ok<T extends object>(r: OpResult<T>): Extract<OpResult<T>, { ok: true }> {
  if (!r.ok) throw new Error(`Expected ok, got ${r.error}${r.detail ? ` (${r.detail})` : ''}`);
  return r as Extract<OpResult<T>, { ok: true }>;
}

export function expectConsistent(state: AppState): void {
  const v = verifyLedger(state);
  if (!v.ok) throw new Error(`Ledger drift: ${JSON.stringify(v.drift)}`);
}

export function balance(state: AppState, id: string): number {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`no account ${id}`);
  return a.balance;
}

export const CARD_DEFAULTS: Omit<CardInput, 'accountId'> = {
  nickname: 'Everyday',
  holderName: 'ALEX MORGAN',
  issuerName: 'VELTRIX',
  style: 'obsidian',
  customFrom: '#111111',
  customTo: '#222222',
  accent: '#2DD4A7',
  pattern: 'lines',
  network: 'vx',
  kind: 'debit',
  displayDigits: '4242',
  expiry: '09/30',
  showExpiry: true,
  spendLimit: 0,
  spendOverride: null,
};

/**
 * Wallet (USD 1,000.00), checking (USD 500.00), savings (0), EUR wallet (EUR 200.00),
 * investment (USD 10,000.00), credit (limit 2,000.00, 300.00 used), one debit card,
 * one credit card and one contact.
 */
export function fixture(): { state: AppState; ctx: OpContext } {
  const ctx = ctxAt();
  let s = baseState({
    preset: 'sandbox',
    displayName: 'Alex Morgan',
    currency: 'USD',
    theme: 'dark',
    startingBalance: 0,
    cardStyle: 'obsidian',
    sampleTransactions: false,
    marketDemo: true,
    now: T0,
    walletId: 'VX-DEMO-TEST-0001',
  });
  const add = (r: OpResult<object>) => {
    s = ok(r).state;
  };
  add(createAccount(s, { id: 'acc_main', kind: 'wallet', name: 'Main Wallet', currency: 'USD', opening: 100_000, color: '#2DD4A7' }, ctx));
  add(createAccount(s, { id: 'acc_checking', kind: 'checking', name: 'Checking', currency: 'USD', opening: 50_000, color: '#3B82F6' }, ctx));
  add(createAccount(s, { id: 'acc_savings', kind: 'savings', name: 'Savings', currency: 'USD', opening: 0, color: '#F5A524' }, ctx));
  add(createAccount(s, { id: 'acc_eur', kind: 'foreign', name: 'EUR Wallet', currency: 'EUR', opening: 20_000, color: '#22D3EE' }, ctx));
  add(createAccount(s, { id: 'acc_jpy', kind: 'foreign', name: 'JPY Wallet', currency: 'JPY', opening: 0, color: '#E879F9' }, ctx));
  add(createAccount(s, { id: 'acc_invest', kind: 'investment', name: 'Investment', currency: 'USD', opening: 1_000_000, color: '#10B981' }, ctx));
  add(
    createAccount(
      s,
      { id: 'acc_credit', kind: 'credit', name: 'Credit', currency: 'USD', opening: 30_000, color: '#F45B69', credit: { limit: 200_000, statementBalance: 25_000, dueDate: '2026-03-28' } },
      ctx,
    ),
  );
  add(createCard(s, { ...CARD_DEFAULTS, accountId: 'acc_main' }, ctx));
  add(createCard(s, { ...CARD_DEFAULTS, nickname: 'Travel', kind: 'credit', style: 'royal', accountId: 'acc_credit', displayDigits: '1881' }, ctx));
  add(createContact(s, { name: 'Ava Laurent', username: 'ava.laurent', identifier: '', color: '#7C6CF2', note: '', favorite: true }, ctx));
  return { state: s, ctx };
}
