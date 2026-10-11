import { ArrowDown } from 'lucide-react';
import { useState } from 'react';
import { CURRENCIES } from '../domain/currency';
import { availableFunds } from '../domain/ledger';
import { parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID } from '../domain/ops/common';
import { transfer } from '../domain/ops/payments';
import type { AppState } from '../domain/types';
import { graphemeLength, NOTE_MAX } from '../domain/validation';
import { act, newOpKey } from '../state/actions';
import { getSnapshot, useApp } from '../state/store';
import { openSheet } from '../state/ui';
import { AccountGlyph } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { useFmt } from '../ui/components/Money';
import { pickAccount, SheetHeader } from '../ui/components/pickers';
import { Button, Field, Notice, TextInput } from '../ui/components/primitives';

function TransferSheet({ fromId: f0, toId: t0, close }: { fromId?: string; toId?: string; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const usable = app.accounts.filter((a) => !a.archived);
  const initialTo = usable.find((a) => a.id === t0);
  const initialFrom =
    usable.find((a) => a.id === f0) ??
    usable.filter((a) => a.kind !== 'credit' && a.id !== initialTo?.id && (!initialTo || a.currency === initialTo.currency)).sort((a, b) => b.balance - a.balance)[0] ??
    usable.find((a) => a.id === MAIN_ACCOUNT_ID);
  const [fromId, setFromId] = useState(initialFrom?.id ?? MAIN_ACCOUNT_ID);
  const from = app.accounts.find((a) => a.id === fromId)!;
  const [toId, setToId] = useState(initialTo?.id ?? usable.find((a) => a.id !== fromId && a.currency === from.currency)?.id ?? '');
  const to = app.accounts.find((a) => a.id === toId);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [opKey] = useState(() => newOpKey('transfer'));
  const parsed = text ? parseAmount(text, CURRENCIES[from.currency].decimals) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  const owed = to?.kind === 'credit' ? Math.max(0, -to.balance) : null;
  const tracked = app.settings.trackBalances;
  let err: string | null = null;
  if (amount > 0 && tracked && amount > from.balance) err = 'Not enough simulated funds';
  else if (amount > 0 && owed !== null && tracked && amount > owed) err = `Only ${f.money(owed, from.currency)} is owed`;
  const submit = () => {
    const r = act((s, ctx) => transfer(s, { fromId, toId, amount, note, opKey }, ctx), { success: to?.kind === 'credit' ? 'Simulated credit payment made' : 'Simulated transfer completed' });
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title={to?.kind === 'credit' ? 'Pay simulated credit' : 'Transfer between accounts'} onClose={close} />
      <div className="sheet-body">
        <button
          className="select-btn"
          onClick={async () => {
            const id = await pickAccount(getSnapshot().app as AppState, { current: fromId, title: 'From', filter: (a) => a.kind !== 'credit' });
            if (id) {
              setFromId(id);
              const nf = app.accounts.find((a) => a.id === id)!;
              if (!to || to.currency !== nf.currency || to.id === id) setToId(usable.find((a) => a.id !== id && a.currency === nf.currency)?.id ?? '');
              setText('');
            }
          }}
        >
          <AccountGlyph icon={from.icon} color={from.color} size={34} />
          <div className="row-main">
            <div className="row-sub">From</div>
            <div className="row-title">{from.name}</div>
          </div>
          <div className="row-end small muted amount">{f.money(availableFunds(from), from.currency, { sensitive: true })}</div>
        </button>
        <div className="center" style={{ margin: '4px 0' }}>
          <ArrowDown size={18} className="faint" />
        </div>
        <button
          className="select-btn"
          onClick={async () => {
            const id = await pickAccount(getSnapshot().app as AppState, { current: toId, title: 'To', filter: (a) => a.id !== fromId && a.currency === from.currency });
            if (id) setToId(id);
          }}
        >
          {to ? <AccountGlyph icon={to.icon} color={to.color} size={34} /> : null}
          <div className="row-main">
            <div className="row-sub">To</div>
            <div className="row-title">{to?.name ?? `Choose a ${from.currency} account`}</div>
          </div>
          {to && <div className="row-end small muted amount">{owed !== null ? `owes ${f.money(owed, to.currency, { sensitive: true })}` : f.money(to.balance, to.currency, { sensitive: true })}</div>}
        </button>
        {!to && <Notice style={{ marginTop: 10 }}>Transfers need two accounts in the same currency. Use Exchange to move money between currencies.</Notice>}
        <div className="amount-entry">
          <AmountDisplay text={text} currency={from.currency} locale={f.locale} invalid={!!err} />
          <div className="small" style={{ minHeight: 20 }}>
            {err ? <span className="neg">{err}</span> : owed !== null ? <button className="link-btn" onClick={() => setText(String(Math.min(owed, from.balance) / 10 ** CURRENCIES[from.currency].decimals))}>Pay full amount owed</button> : null}
          </div>
        </div>
        <Keypad value={text} onChange={setText} currency={from.currency} />
        <div style={{ marginTop: 10 }}>
          <Field counter={`${graphemeLength(note)}/${NOTE_MAX}`}>
            <TextInput value={note} onChange={setNote} placeholder="Note (optional)" />
          </Field>
        </div>
      </div>
      <div className="sheet-foot">
        <Button block onClick={submit} disabled={!to || amount <= 0 || !!err || graphemeLength(note) > NOTE_MAX}>
          {to?.kind === 'credit' ? 'Pay' : 'Transfer'} {amount > 0 ? f.money(amount, from.currency) : ''}
        </Button>
      </div>
    </>
  );
}

export function openTransferSheet(opts: { fromId?: string; toId?: string } = {}): void {
  openSheet((close) => <TransferSheet fromId={opts.fromId} toId={opts.toId} close={close} />, { tall: true });
}
