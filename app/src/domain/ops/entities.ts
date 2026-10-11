import { isCurrencyCode, type CurrencyCode } from '../currency';
import { isDayKey } from '../dates';
import { postTxn, requireAccount } from '../ledger';
import { MAX_BALANCE_MINOR } from '../money';
import type {
  Account,
  AccountIcon,
  AccountKind,
  AppState,
  Card,
  CardKind,
  CardNetwork,
  CardPattern,
  CardStyle,
  Contact,
  CreditProfile,
  OpContext,
  OpResult,
} from '../types';
import {
  cleanText,
  isHexColor,
  normalizeUsername,
  truncateGraphemes,
  validateDisplayDigits,
  validateExpiry,
  validateIdentifier,
  validateName,
  validateUsername,
} from '../validation';
import { fail, MAIN_ACCOUNT_ID, newTxn } from './common';
import { adjustBalance } from './payments';

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  wallet: 'Wallet',
  checking: 'Checking',
  savings: 'Savings',
  card: 'Virtual card balance',
  investment: 'Investment cash',
  foreign: 'Currency balance',
  credit: 'Credit (simulated)',
};

export const DEFAULT_ACCOUNT_ICON: Record<AccountKind, AccountIcon> = {
  wallet: 'wallet',
  checking: 'landmark',
  savings: 'piggy',
  card: 'card',
  investment: 'chart',
  foreign: 'globe',
  credit: 'credit',
};

export interface CreateAccountInput {
  kind: AccountKind;
  name: string;
  currency: CurrencyCode;
  /** Asset accounts: opening balance ≥ 0. Credit accounts: amount already used (≥ 0). */
  opening: number;
  color: string;
  icon?: AccountIcon;
  credit?: CreditProfile;
  showOnDashboard?: boolean;
  id?: string;
}

export function createAccount(state: AppState, input: CreateAccountInput, ctx: OpContext): OpResult<{ account: Account }> {
  const nameErr = validateName(input.name, 'Account name');
  if (nameErr) return fail('invalid_input', nameErr);
  if (!isCurrencyCode(input.currency)) return fail('invalid_input', 'Unknown currency');
  if (!Number.isSafeInteger(input.opening) || input.opening < 0 || input.opening > MAX_BALANCE_MINOR) return fail('invalid_amount');
  if (input.kind === 'credit') {
    const c = input.credit;
    if (!c || !Number.isSafeInteger(c.limit) || c.limit <= 0) return fail('invalid_input', 'Credit limit must be greater than zero');
    if (input.opening > c.limit) return fail('invalid_input', 'Used credit cannot exceed the limit');
    if (c.statementBalance < 0 || c.statementBalance > c.limit) return fail('invalid_input', 'Statement balance must be between 0 and the limit');
    if (!isDayKey(c.dueDate)) return fail('invalid_input', 'Choose a valid due date');
  }
  const id = input.id ?? ctx.id('acc');
  if (state.accounts.some((a) => a.id === id)) return fail('invalid_input', 'Account already exists');
  const account: Account = {
    id,
    kind: input.kind,
    name: truncateGraphemes(cleanText(input.name), 40),
    currency: input.currency,
    balance: 0,
    color: input.color,
    icon: input.icon ?? DEFAULT_ACCOUNT_ICON[input.kind],
    showOnDashboard: input.showOnDashboard ?? true,
    hideAmount: false,
    archived: false,
    order: state.accounts.reduce((m, a) => Math.max(m, a.order), -1) + 1,
    createdAt: ctx.now.toISOString(),
    credit: input.kind === 'credit' ? { ...(input.credit as CreditProfile) } : undefined,
  };
  let next: AppState = { ...state, accounts: [...state.accounts, account] };
  if (input.opening > 0) {
    const txn = newTxn(ctx, {
      type: 'adjustment',
      subtype: 'opening',
      title: input.kind === 'credit' ? 'Opening used credit' : 'Opening balance',
      amount: input.opening,
      currency: input.currency,
      direction: input.kind === 'credit' ? 'out' : 'in',
      accountId: id,
      category: 'other',
      applied: true,
    });
    next = postTxn(next, txn);
  }
  return { ok: true, state: next, account: next.accounts.find((a) => a.id === id) as Account };
}

export interface AccountPatch {
  name?: string;
  color?: string;
  icon?: AccountIcon;
  showOnDashboard?: boolean;
  hideAmount?: boolean;
}

export function updateAccount(state: AppState, id: string, patch: AccountPatch): OpResult<{ account: Account }> {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return fail('account_not_found');
  const upd: Partial<Account> = {};
  if (patch.name !== undefined) {
    const e = validateName(patch.name, 'Account name');
    if (e) return fail('invalid_input', e);
    upd.name = truncateGraphemes(cleanText(patch.name), 40);
  }
  if (patch.color !== undefined) upd.color = patch.color;
  if (patch.icon !== undefined) upd.icon = patch.icon;
  if (patch.showOnDashboard !== undefined) upd.showOnDashboard = patch.showOnDashboard;
  if (patch.hideAmount !== undefined) upd.hideAmount = patch.hideAmount;
  const next = { ...state, accounts: state.accounts.map((a) => (a.id === id ? { ...a, ...upd } : a)) };
  return { ok: true, state: next, account: next.accounts.find((a) => a.id === id) as Account };
}

export function archiveAccount(state: AppState, id: string): OpResult {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return fail('account_not_found');
  if (id === MAIN_ACCOUNT_ID) return fail('cannot_archive', 'The main wallet cannot be archived.');
  if (acc.balance !== 0) return fail('cannot_archive', 'Move the remaining simulated balance out first.');
  if (state.cards.some((c) => c.accountId === id)) return fail('cannot_archive', 'Delete or relink the cards that use this account first.');
  if (acc.kind === 'investment' && Object.keys(state.markets.positions).length > 0) return fail('cannot_archive', 'Close your simulated positions first.');
  const settings = state.settings.defaultAccountId === id ? { ...state.settings, defaultAccountId: MAIN_ACCOUNT_ID } : state.settings;
  return { ok: true, state: { ...state, settings, accounts: state.accounts.map((a) => (a.id === id ? { ...a, archived: true, showOnDashboard: false } : a)) } };
}

export function moveAccount(state: AppState, id: string, delta: -1 | 1): AppState {
  const list = state.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order);
  const idx = list.findIndex((a) => a.id === id);
  const swap = idx + delta;
  if (idx === -1 || swap < 0 || swap >= list.length) return state;
  const orderA = list[idx].order;
  const orderB = list[swap].order;
  return {
    ...state,
    accounts: state.accounts.map((a) => (a.id === list[idx].id ? { ...a, order: orderB } : a.id === list[swap].id ? { ...a, order: orderA } : a)),
  };
}

/* ------------------------------------------------------------------ */
/* Simulated credit account                                            */
/* ------------------------------------------------------------------ */

export interface CreditFigures {
  limit: number;
  used: number;
  available: number;
  utilization: number; // percent, 0–100 (one decimal)
  statementBalance: number;
  minimumDue: number;
  dueDate: string;
}

export function minimumDue(statement: number): number {
  if (statement <= 0) return 0;
  const pct = Math.round(statement * 0.02);
  return Math.min(statement, Math.max(2500, pct));
}

export function creditFigures(acc: Account): CreditFigures {
  const limit = acc.credit?.limit ?? 0;
  const used = Math.max(0, -acc.balance);
  const statementBalance = acc.credit?.statementBalance ?? 0;
  return {
    limit,
    used,
    available: Math.max(0, limit + acc.balance),
    utilization: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
    statementBalance,
    minimumDue: minimumDue(statementBalance),
    dueDate: acc.credit?.dueDate ?? '',
  };
}

export type CreditEditField = 'limit' | 'used' | 'available' | 'utilization';

export interface CreditEdit {
  limit: number;
  /** which of used / available / utilization the user typed last (the others are derived) */
  driver: Exclude<CreditEditField, 'limit'>;
  used?: number;
  available?: number;
  utilization?: number;
  statementBalance: number;
  dueDate: string;
}

/** Resolves a credit edit into consistent figures or a validation message. */
export function resolveCreditEdit(edit: CreditEdit): { ok: true; limit: number; used: number; statementBalance: number; dueDate: string } | { ok: false; message: string } {
  const { limit } = edit;
  if (!Number.isSafeInteger(limit) || limit <= 0) return { ok: false, message: 'Credit limit must be greater than zero.' };
  if (limit > MAX_BALANCE_MINOR) return { ok: false, message: 'Credit limit is too large.' };
  let used: number;
  if (edit.driver === 'used') used = edit.used ?? 0;
  else if (edit.driver === 'available') used = limit - (edit.available ?? 0);
  else {
    const u = edit.utilization ?? 0;
    if (!Number.isFinite(u) || u < 0 || u > 100) return { ok: false, message: 'Utilization must be between 0% and 100%.' };
    used = Math.round((limit * u) / 100);
  }
  if (!Number.isSafeInteger(used)) return { ok: false, message: 'Enter a valid amount.' };
  if (used < 0) return { ok: false, message: 'Available credit cannot exceed the limit.' };
  if (used > limit) return { ok: false, message: 'Used credit cannot exceed the credit limit.' };
  if (!Number.isSafeInteger(edit.statementBalance) || edit.statementBalance < 0) return { ok: false, message: 'Statement balance cannot be negative.' };
  if (edit.statementBalance > limit) return { ok: false, message: 'Statement balance cannot exceed the credit limit.' };
  if (!isDayKey(edit.dueDate)) return { ok: false, message: 'Choose a valid payment due date.' };
  return { ok: true, limit, used, statementBalance: edit.statementBalance, dueDate: edit.dueDate };
}

/**
 * Applies a credit edit. The limit/statement/due date are display parameters;
 * a change of *used* credit moves the balance and is therefore recorded as a
 * visible adjustment entry in the ledger.
 */
export function applyCreditEdit(state: AppState, accountId: string, edit: CreditEdit, ctx: OpContext): OpResult {
  const acc = requireAccount(state, accountId);
  if (typeof acc === 'string') return fail(acc);
  if (acc.kind !== 'credit') return fail('invalid_input');
  const r = resolveCreditEdit(edit);
  if (!r.ok) return fail('invalid_input', r.message);
  let next: AppState = {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, credit: { limit: r.limit, statementBalance: r.statementBalance, dueDate: r.dueDate } } : a,
    ),
  };
  const targetBalance = -r.used;
  if (targetBalance !== acc.balance) {
    const adj = adjustBalance(next, { accountId, mode: 'set', amount: targetBalance, title: 'Used credit edited', note: 'Simulated credit figures edited' }, ctx);
    if (!adj.ok) return adj;
    next = adj.state;
  }
  return { ok: true, state: next };
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export const CARD_STYLES: CardStyle[] = ['obsidian', 'glacier', 'emerald', 'royal', 'aurora', 'carbon', 'pearl', 'neon', 'midnight', 'custom'];
export const CARD_PATTERNS: CardPattern[] = ['none', 'lines', 'waves', 'grid', 'topo', 'dots', 'mesh'];
export const CARD_NETWORKS: CardNetwork[] = ['vx', 'orbit', 'nexa', 'neutral'];
export const CARD_KINDS: CardKind[] = ['debit', 'credit', 'prepaid'];

export interface CardInput {
  nickname: string;
  holderName: string;
  issuerName: string;
  style: CardStyle;
  customFrom: string;
  customTo: string;
  accent: string;
  pattern: CardPattern;
  network: CardNetwork;
  kind: CardKind;
  accountId: string;
  displayDigits: string;
  expiry: string;
  showExpiry: boolean;
  spendLimit: number;
  spendOverride: number | null;
}

export function validateCardInput(state: AppState, input: CardInput): string | null {
  return (
    validateName(input.nickname, 'Card nickname') ??
    validateName(input.holderName, 'Cardholder name') ??
    validateName(input.issuerName, 'Issuer name') ??
    (CARD_STYLES.includes(input.style) ? null : 'Unknown card style') ??
    (CARD_PATTERNS.includes(input.pattern) ? null : 'Unknown pattern') ??
    (CARD_NETWORKS.includes(input.network) ? null : 'Unknown network style') ??
    (CARD_KINDS.includes(input.kind) ? null : 'Unknown card type') ??
    (isHexColor(input.customFrom) && isHexColor(input.customTo) && isHexColor(input.accent) ? null : 'Colors must be #RRGGBB') ??
    validateDisplayDigits(input.displayDigits) ??
    (input.showExpiry ? validateExpiry(input.expiry) : null) ??
    (Number.isSafeInteger(input.spendLimit) && input.spendLimit >= 0 ? null : 'Spending limit is not valid') ??
    (input.spendOverride === null || (Number.isSafeInteger(input.spendOverride) && input.spendOverride >= 0) ? null : 'Monthly spending is not valid') ??
    cardAccountError(state, input)
  );
}

function cardAccountError(state: AppState, input: CardInput): string | null {
  const acc = state.accounts.find((a) => a.id === input.accountId && !a.archived);
  if (!acc) return 'Choose the account this card uses';
  if (input.kind === 'credit' && acc.kind !== 'credit') return 'Credit-style cards must use a simulated credit account';
  if (input.kind !== 'credit' && acc.kind === 'credit') return 'Only credit-style cards can use a credit account';
  if (acc.kind === 'investment') return 'Cards cannot use the investment account';
  return null;
}

export function createCard(state: AppState, input: CardInput, ctx: OpContext): OpResult<{ card: Card }> {
  const e = validateCardInput(state, input);
  if (e) return fail('invalid_input', e);
  const card: Card = {
    id: ctx.id('card'),
    ...input,
    nickname: cleanText(input.nickname),
    holderName: cleanText(input.holderName),
    issuerName: cleanText(input.issuerName),
    status: 'active',
    order: state.cards.reduce((m, c) => Math.max(m, c.order), -1) + 1,
    createdAt: ctx.now.toISOString(),
  };
  let next: AppState = { ...state, cards: [...state.cards, card] };
  if (!next.settings.defaultCardId || !next.cards.some((c) => c.id === next.settings.defaultCardId)) {
    next = { ...next, settings: { ...next.settings, defaultCardId: card.id } };
  }
  return { ok: true, state: next, card };
}

export function updateCard(state: AppState, id: string, patch: Partial<CardInput>): OpResult<{ card: Card }> {
  const card = state.cards.find((c) => c.id === id);
  if (!card) return fail('card_not_found');
  const merged: CardInput = { ...card, ...patch };
  const e = validateCardInput(state, merged);
  if (e) return fail('invalid_input', e);
  const updated: Card = {
    ...card,
    ...patch,
    nickname: cleanText(merged.nickname),
    holderName: cleanText(merged.holderName),
    issuerName: cleanText(merged.issuerName),
  };
  return { ok: true, state: { ...state, cards: state.cards.map((c) => (c.id === id ? updated : c)) }, card: updated };
}

export function setCardStatus(state: AppState, id: string, status: Card['status']): OpResult<{ card: Card }> {
  const card = state.cards.find((c) => c.id === id);
  if (!card) return fail('card_not_found');
  const updated = { ...card, status };
  return { ok: true, state: { ...state, cards: state.cards.map((c) => (c.id === id ? updated : c)) }, card: updated };
}

export function deleteCard(state: AppState, id: string): OpResult {
  if (!state.cards.some((c) => c.id === id)) return fail('card_not_found');
  const cards = state.cards.filter((c) => c.id !== id);
  const sorted = [...cards].sort((a, b) => a.order - b.order);
  const settings = state.settings.defaultCardId === id ? { ...state.settings, defaultCardId: sorted[0]?.id ?? '' } : state.settings;
  // Ledger entries keep their cardId for history; the UI labels them "Deleted card".
  return { ok: true, state: { ...state, cards, settings } };
}

export function moveCard(state: AppState, id: string, delta: number): AppState {
  const sorted = [...state.cards].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((c) => c.id === id);
  const target = Math.max(0, Math.min(sorted.length - 1, idx + delta));
  if (idx === -1 || target === idx) return state;
  const [moved] = sorted.splice(idx, 1);
  sorted.splice(target, 0, moved);
  const order = new Map(sorted.map((c, i) => [c.id, i]));
  return { ...state, cards: state.cards.map((c) => ({ ...c, order: order.get(c.id) ?? c.order })) };
}

export function sortedCards(state: AppState): Card[] {
  return [...state.cards].sort((a, b) => a.order - b.order);
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export interface ContactInput {
  name: string;
  username: string;
  identifier: string;
  color: string;
  note: string;
  favorite: boolean;
}

export function validateContact(state: AppState, input: ContactInput, ignoreId?: string): { field: keyof ContactInput; message: string } | null {
  const n = validateName(input.name, 'Name');
  if (n) return { field: 'name', message: n };
  const u = validateUsername(input.username);
  if (u) return { field: 'username', message: u };
  const uname = normalizeUsername(input.username);
  if (state.contacts.some((c) => c.username === uname && c.id !== ignoreId)) return { field: 'username', message: 'Another contact already uses this username' };
  const i = validateIdentifier(input.identifier);
  if (i) return { field: 'identifier', message: i };
  if (cleanText(input.note).length > 140) return { field: 'note', message: 'Keep the note under 140 characters' };
  return null;
}

export function createContact(state: AppState, input: ContactInput, ctx: OpContext): OpResult<{ contact: Contact }> {
  const e = validateContact(state, input);
  if (e) return fail(e.field === 'username' && e.message.startsWith('Another') ? 'duplicate_username' : 'invalid_input', e.message);
  const contact: Contact = {
    id: ctx.id('ct'),
    name: truncateGraphemes(cleanText(input.name), 40),
    username: normalizeUsername(input.username),
    identifier: input.identifier.trim(),
    color: input.color,
    note: cleanText(input.note),
    favorite: input.favorite,
    createdAt: ctx.now.toISOString(),
  };
  return { ok: true, state: { ...state, contacts: [...state.contacts, contact] }, contact };
}

export function updateContact(state: AppState, id: string, input: ContactInput): OpResult<{ contact: Contact }> {
  const existing = state.contacts.find((c) => c.id === id);
  if (!existing) return fail('contact_not_found');
  const e = validateContact(state, input, id);
  if (e) return fail(e.field === 'username' && e.message.startsWith('Another') ? 'duplicate_username' : 'invalid_input', e.message);
  const contact: Contact = {
    ...existing,
    name: truncateGraphemes(cleanText(input.name), 40),
    username: normalizeUsername(input.username),
    identifier: input.identifier.trim(),
    color: input.color,
    note: cleanText(input.note),
    favorite: input.favorite,
  };
  return { ok: true, state: { ...state, contacts: state.contacts.map((c) => (c.id === id ? contact : c)) }, contact };
}

export function deleteContact(state: AppState, id: string): OpResult {
  if (!state.contacts.some((c) => c.id === id)) return fail('contact_not_found');
  // History keeps the counterparty name; only the contact card is removed.
  return { ok: true, state: { ...state, contacts: state.contacts.filter((c) => c.id !== id) } };
}

export function toggleFavorite(state: AppState, id: string): AppState {
  return { ...state, contacts: state.contacts.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)) };
}
