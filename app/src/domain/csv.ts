import { CURRENCIES } from './currency';
import { simRef } from './ids';
import { CATEGORY_LABEL, STATUS_LABEL, txnTypeLabel } from './labels';
import { minorToDecimalString } from './money';
import type { AppState, Txn } from './types';

/** Neutralises spreadsheet formula injection in text cells. */
function text(v: string | undefined | null): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return quote(s);
}

function quote(s: string): string {
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function num(minor: number | undefined, decimals: number): string {
  if (minor === undefined) return '';
  return minorToDecimalString(minor, decimals);
}

const pad = (n: number) => String(n).padStart(2, '0');

export const CSV_HEADER = [
  'Simulation',
  'Date',
  'Time',
  'Reference',
  'Type',
  'Status',
  'Title',
  'Counterparty',
  'Category',
  'Account',
  'To account',
  'Card',
  'Currency',
  'Amount',
  'Fee',
  'Balance after',
  'Applied to balance',
  'Note',
  'Tags',
];

/** Ledger → CSV. Every row is explicitly marked as simulated. */
export function ledgerToCsv(state: AppState, txns: Txn[]): string {
  const rows = [CSV_HEADER.join(',')];
  for (const t of txns) {
    const d = new Date(t.createdAt);
    const dec = CURRENCIES[t.currency].decimals;
    const signed = t.direction === 'in' ? t.amount : -t.amount;
    const acc = state.accounts.find((a) => a.id === t.accountId);
    const to = t.toAccountId ? state.accounts.find((a) => a.id === t.toAccountId) : undefined;
    const card = t.cardId ? state.cards.find((c) => c.id === t.cardId) : undefined;
    rows.push(
      [
        'SIMULATED',
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        simRef(t.id),
        text(txnTypeLabel(t)),
        text(STATUS_LABEL[t.status]),
        text(t.title),
        text(t.counterparty?.name),
        text(CATEGORY_LABEL[t.category]),
        text(acc?.name ?? 'Deleted account'),
        text(to?.name),
        text(card ? card.nickname : t.cardId ? 'Deleted card' : ''),
        t.currency,
        num(signed, dec),
        num(t.fee, dec),
        num(t.balanceAfter, dec),
        t.applied ? 'yes' : 'no',
        text(t.note),
        text(t.tags.join(' ')),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}
