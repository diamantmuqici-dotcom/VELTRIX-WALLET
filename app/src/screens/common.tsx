import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '../domain/currency';
import { simRef } from '../domain/ids';
import { rowStatus, txnTypeLabel } from '../domain/labels';
import { minorToKeypadText, parseAmount, parseSignedAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID } from '../domain/ops/common';
import { adjustBalance } from '../domain/ops/payments';
import type { Account, AppState, Txn } from '../domain/types';
import { NOTE_MAX, graphemeLength } from '../domain/validation';
import { act, newOpKey } from '../state/actions';
import { getSnapshot, useApp } from '../state/store';
import { nav, openSheet } from '../state/ui';
import { AccountGlyph, TxnGlyph } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { useFmt } from '../ui/components/Money';
import { pickAccount, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Field, Segmented, TextInput, useScreen } from '../ui/components/primitives';

/** Re-renders every `ms` while the screen is visible (live demo prices, relative times). */
export function useNow(ms: number): number {
  const { visible } = useScreen();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [visible, ms]);
  return now;
}

export function accountName(app: AppState, id: string | undefined): string {
  if (!id) return '';
  return app.accounts.find((a) => a.id === id)?.name ?? 'Deleted account';
}

/** Amount shown in lists, from the point of view of `accountId` when given. */
export function displayAmount(t: Txn, accountId?: string): { minor: number; currency: CurrencyCode; signed: boolean } {
  if (t.direction === 'internal') {
    if (accountId && t.toAccountId === accountId && t.accountId !== accountId) {
      return { minor: t.fx ? t.fx.targetAmount : t.amount, currency: t.fx ? t.fx.to : t.currency, signed: true };
    }
    if (accountId) return { minor: -(t.amount + t.fee), currency: t.currency, signed: true };
    return { minor: t.amount, currency: t.currency, signed: false };
  }
  return { minor: t.direction === 'in' ? t.amount - t.fee : -(t.amount + t.fee), currency: t.currency, signed: true };
}

export function TxnRow({ t, accountId, showDate = true }: { t: Txn; accountId?: string; showDate?: boolean }) {
  const app = useApp();
  const f = useFmt();
  const amt = displayAmount(t, accountId);
  const status = rowStatus(t);
  const muted = t.status === 'canceled' || t.status === 'reversed';
  const sub =
    t.direction === 'internal' && t.toAccountId
      ? `${accountName(app, t.accountId)} → ${accountName(app, t.toAccountId)}`
      : `${txnTypeLabel(t)}${showDate ? ` · ${f.day(t.createdAt)}` : ` · ${f.time(t.createdAt)}`}`;
  return (
    <button type="button" className="row" onClick={() => nav.push('txn', { id: t.id })} aria-label={`${t.title}, ${f.money(amt.minor, amt.currency, { sign: amt.signed ? 'exceptZero' : 'auto' })}`}>
      <TxnGlyph t={t} state={app} />
      <div className="row-main">
        <div className="row-title" style={muted ? { textDecoration: 'line-through', color: 'var(--text-2)' } : undefined}>
          {t.title}
        </div>
        <div className="row-sub">{sub}</div>
      </div>
      <div className="row-end">
        <div className={`row-title amount${amt.signed && amt.minor > 0 && t.status === 'completed' && t.applied ? ' pos' : ''}`} style={muted ? { color: 'var(--text-3)' } : t.status === 'pending' ? { color: 'var(--text-2)' } : undefined}>
          {t.direction === 'internal' && !amt.signed && <ArrowLeftRight size={13} style={{ marginRight: 4, verticalAlign: -1, color: 'var(--text-3)' }} />}
          {f.money(amt.minor, amt.currency, { sign: amt.signed ? 'exceptZero' : 'auto', sensitive: false })}
        </div>
        {status ? (
          <div className="row-sub">
            <Badge tone={t.status === 'pending' ? 'sim' : 'muted'}>{status}</Badge>
          </div>
        ) : showDate ? null : (
          <div className="row-sub faint xsmall">{simRef(t.id)}</div>
        )}
      </div>
    </button>
  );
}

export function AccountRow({ a, onClick, sub }: { a: Account; onClick?: () => void; sub?: string }) {
  const f = useFmt();
  return (
    <button type="button" className="row" onClick={onClick ?? (() => nav.push('account', { id: a.id }))}>
      <AccountGlyph icon={a.icon} color={a.color} />
      <div className="row-main">
        <div className="row-title">{a.name}</div>
        <div className="row-sub">{sub ?? `${a.currency}${a.showOnDashboard ? '' : ' · hidden on Home'}`}</div>
      </div>
      <div className="row-end">
        <div className="row-title amount">{f.money(a.balance, a.currency, { sensitive: true })}</div>
        {a.kind === 'credit' && <div className="row-sub">owed</div>}
      </div>
    </button>
  );
}

/* --------------------------- Adjust balance -------------------------- */

type AdjustMode = 'add' | 'remove' | 'set';

function AdjustSheetBody({ initialAccount, initialMode, close }: { initialAccount: string; initialMode: AdjustMode; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const [accountId, setAccountId] = useState(initialAccount);
  const [mode, setMode] = useState<AdjustMode>(initialMode);
  const acc = app.accounts.find((a) => a.id === accountId) ?? app.accounts[0];
  const dec = CURRENCIES[acc.currency].decimals;
  const [text, setText] = useState(() => (initialMode === 'set' && acc.kind !== 'credit' ? minorToKeypadText(acc.balance, dec) : ''));
  const [note, setNote] = useState('');
  const [opKey] = useState(() => newOpKey('adjust'));
  const isCredit = acc.kind === 'credit';
  // For credit accounts "set" edits the amount owed (shown positive).
  const parsed = mode === 'set' ? (text === '' ? null : parseSignedAmount(text, dec)) : text === '' ? null : parseAmount(text, dec);
  const amount = parsed && parsed.ok ? parsed.minor : null;
  const preview = useMemo(() => {
    if (amount === null) return null;
    if (mode === 'set') return isCredit ? -amount : amount;
    return acc.balance + (mode === 'add' ? amount : -amount);
  }, [amount, mode, acc.balance, isCredit]);
  const invalidPreview = preview !== null && (isCredit ? preview > 0 || -preview > (acc.credit?.limit ?? 0) : preview < 0);
  const submit = () => {
    if (amount === null) return;
    const r = act(
      (s, ctx) =>
        adjustBalance(
          s,
          { accountId: acc.id, mode, amount: mode === 'set' && isCredit ? -amount : amount, note, opKey },
          ctx,
        ),
      { success: 'Simulated balance updated' },
    );
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title="Adjust simulated balance" onClose={close} />
      <div className="sheet-body">
        <Segmented
          value={mode}
          label="Adjustment type"
          onChange={(m) => {
            setMode(m);
            setText(m === 'set' && !isCredit ? minorToKeypadText(acc.balance, dec) : '');
          }}
          options={[
            { value: 'add', label: isCredit ? 'Pay down' : 'Add' },
            { value: 'remove', label: isCredit ? 'Charge' : 'Remove' },
            { value: 'set', label: isCredit ? 'Set owed' : 'Set balance' },
          ]}
        />
        <button
          type="button"
          className="select-btn"
          style={{ marginTop: 12 }}
          onClick={async () => {
            const id = await pickAccount(getSnapshot().app as AppState, { current: accountId, title: 'Account to adjust' });
            if (id) {
              setAccountId(id);
              setText('');
            }
          }}
        >
          <AccountGlyph icon={acc.icon} color={acc.color} size={34} />
          <div className="row-main">
            <div className="row-title">{acc.name}</div>
            <div className="row-sub">
              Current {f.money(acc.balance, acc.currency)}
              {isCredit ? ' (owed)' : ''}
            </div>
          </div>
          <span className="link-btn">Change</span>
        </button>
        <div className="amount-entry">
          <AmountDisplay text={text} currency={acc.currency} locale={f.locale} invalid={invalidPreview} />
          <div className="small muted" style={{ minHeight: 20 }}>
            {preview !== null && (
              <span className={invalidPreview ? 'neg' : undefined}>
                New balance {f.money(preview, acc.currency)}
                {invalidPreview ? (isCredit ? ' — outside the credit limit' : ' — cannot go below zero') : ''}
              </span>
            )}
          </div>
        </div>
        <Keypad value={text} onChange={setText} currency={acc.currency} />
        <div style={{ marginTop: 10 }}>
          <Field counter={`${graphemeLength(note)}/${NOTE_MAX}`} error={graphemeLength(note) > NOTE_MAX ? 'Note is too long' : null}>
            <TextInput value={note} onChange={setNote} placeholder="Reason (optional), e.g. Opening float" ariaLabel="Reason" />
          </Field>
        </div>
        <p className="disclaimer" style={{ marginTop: 0 }}>
          Manual changes are recorded in the ledger as a visible “Balance adjustment” so the history always adds up. No real money is involved.
        </p>
      </div>
      <div className="sheet-foot">
        <Button block onClick={submit} disabled={amount === null || invalidPreview || (preview !== null && preview === acc.balance) || graphemeLength(note) > NOTE_MAX}>
          {mode === 'set' ? 'Save balance' : mode === 'add' ? 'Add simulated funds' : 'Remove simulated funds'}
        </Button>
      </div>
    </>
  );
}

export function openAdjustSheet(mode: AdjustMode = 'add', accountId: string = MAIN_ACCOUNT_ID): void {
  openSheet((close) => <AdjustSheetBody initialAccount={accountId} initialMode={mode} close={close} />, { tall: true, title: 'Adjust balance' });
}

export function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
