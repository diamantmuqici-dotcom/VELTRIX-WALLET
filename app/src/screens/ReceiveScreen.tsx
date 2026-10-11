import { ArrowDownLeft, Copy, Pencil, Share2, X } from 'lucide-react';
import { useState } from 'react';
import { CURRENCIES } from '../domain/currency';
import { minorToDecimalString, parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID, PAYMENT_KINDS } from '../domain/ops/common';
import { receiveMoney } from '../domain/ops/payments';
import type { AppState, Category } from '../domain/types';
import { graphemeLength, NOTE_MAX } from '../domain/validation';
import { copyText, shareText } from '../platform/bridge';
import { act, newOpKey } from '../state/actions';
import { getSnapshot, useApp } from '../state/store';
import { openSheet, toast } from '../state/ui';
import { AccountGlyph, Avatar } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { useFmt } from '../ui/components/Money';
import { pick, pickAccount, pickCategory, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Field, Page, Section, TextInput } from '../ui/components/primitives';
import { QRCode } from '../ui/components/QR';
import { CATEGORY_LABEL } from '../domain/labels';

function AmountSheet({ currency, initial, onDone, close }: { currency: AppState['accounts'][number]['currency']; initial: string; onDone: (t: string) => void; close: () => void }) {
  const f = useFmt();
  const [text, setText] = useState(initial);
  return (
    <>
      <SheetHeader title="Requested amount" onClose={close} />
      <div className="sheet-body">
        <div className="amount-entry">
          <AmountDisplay text={text} currency={currency} locale={f.locale} />
        </div>
        <Keypad value={text} onChange={setText} currency={currency} />
      </div>
      <div className="sheet-foot btn-row">
        <Button
          variant="secondary"
          onClick={() => {
            onDone('');
            close();
          }}
        >
          No amount
        </Button>
        <Button
          onClick={() => {
            onDone(text);
            close();
          }}
        >
          Use amount
        </Button>
      </div>
    </>
  );
}

function IncomingSheet({ close, accountId: initialAccount }: { close: () => void; accountId: string }) {
  const app = useApp();
  const f = useFmt();
  const [accountId, setAccountId] = useState(initialAccount);
  const acc = app.accounts.find((a) => a.id === accountId) ?? app.accounts[0];
  const [fromContact, setFromContact] = useState<string | null>(app.contacts[0]?.id ?? null);
  const [fromName, setFromName] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<Category>('income');
  const [opKey] = useState(() => newOpKey('receive'));
  const contact = fromContact ? app.contacts.find((c) => c.id === fromContact) : undefined;
  const parsed = text ? parseAmount(text, CURRENCIES[acc.currency].decimals) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  const party = contact ? { contactId: contact.id, name: contact.name, handle: contact.username } : fromName.trim() ? { name: fromName.trim() } : null;
  const submit = () => {
    const r = act((s, ctx) => receiveMoney(s, { from: party, amount, accountId: acc.id, note, category, opKey }, ctx), { success: 'Simulated payment received' });
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title="Simulate incoming payment" onClose={close} />
      <div className="sheet-body">
        <button
          className="select-btn"
          onClick={async () => {
            const v = await pick<string>(
              'From',
              [{ value: '__other', label: 'Someone else (type a fictional name)' }, ...app.contacts.map((c) => ({ value: c.id, label: c.name, sub: `@${c.username}`, icon: <Avatar name={c.name} color={c.color} size={36} /> }))],
              fromContact ?? '__other',
              app.contacts.length > 7,
            );
            if (v) setFromContact(v === '__other' ? null : v);
          }}
        >
          {contact ? <Avatar name={contact.name} color={contact.color} size={34} /> : <span className="tile-ico" style={{ width: 34, height: 34 }}>?</span>}
          <div className="row-main">
            <div className="row-title">{contact ? contact.name : 'Someone else'}</div>
            <div className="row-sub">From</div>
          </div>
          <span className="link-btn">Change</span>
        </button>
        {!contact && (
          <div style={{ marginTop: 10 }}>
            <Field label="Fictional sender name">
              <TextInput value={fromName} onChange={setFromName} placeholder="e.g. Jordan Vale" autoCapitalize="words" />
            </Field>
          </div>
        )}
        <button
          className="select-btn"
          style={{ marginTop: 10 }}
          onClick={async () => {
            const id = await pickAccount(getSnapshot().app!, { current: acc.id, title: 'Deposit to', filter: (a) => PAYMENT_KINDS.includes(a.kind) });
            if (id) {
              setAccountId(id);
              setText('');
            }
          }}
        >
          <AccountGlyph icon={acc.icon} color={acc.color} size={34} />
          <div className="row-main">
            <div className="row-title">{acc.name}</div>
            <div className="row-sub">Deposit to · {acc.currency}</div>
          </div>
          <span className="link-btn">Change</span>
        </button>
        <div className="amount-entry">
          <AmountDisplay text={text} currency={acc.currency} locale={f.locale} invalid={!!parsed && !parsed.ok && text !== '0.'} />
        </div>
        <Keypad value={text} onChange={setText} currency={acc.currency} />
        <div style={{ marginTop: 10 }}>
          <Field counter={`${graphemeLength(note)}/${NOTE_MAX}`} error={graphemeLength(note) > NOTE_MAX ? 'Note is too long' : null}>
            <TextInput value={note} onChange={setNote} placeholder="Note (optional)" />
          </Field>
          <button
            className="select-btn"
            onClick={async () => {
              const c = await pickCategory(category);
              if (c) setCategory(c);
            }}
          >
            <div className="row-main">
              <div className="row-title">Category</div>
              <div className="row-sub">{CATEGORY_LABEL[category]}</div>
            </div>
            <span className="link-btn">Change</span>
          </button>
        </div>
      </div>
      <div className="sheet-foot">
        <Button block onClick={submit} disabled={!party || amount <= 0 || graphemeLength(note) > NOTE_MAX}>
          Receive simulated {amount > 0 ? f.money(amount, acc.currency) : 'payment'}
        </Button>
      </div>
    </>
  );
}

export function openIncomingSheet(accountId: string = MAIN_ACCOUNT_ID): void {
  openSheet((close) => <IncomingSheet close={close} accountId={accountId} />, { tall: true, title: 'Simulate incoming payment' });
}

export function ReceiveScreen() {
  const app = useApp();
  const f = useFmt();
  const main = app.accounts.find((a) => a.id === app.settings.defaultAccountId && PAYMENT_KINDS.includes(a.kind)) ?? app.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!;
  const [amountText, setAmountText] = useState('');
  const dec = CURRENCIES[main.currency].decimals;
  const parsed = amountText ? parseAmount(amountText, dec) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  // Fictional, clearly-marked demo payload. It is not a payment code of any real network.
  const payload = `veltrix-demo://simulated-pay?to=${encodeURIComponent(app.profile.username)}&wallet=${encodeURIComponent(app.profile.walletId)}${amount ? `&amount=${minorToDecimalString(amount, dec)}&currency=${main.currency}` : ''}&demo=1`;
  const shareMsg = [
    `VELTRIX DEMO — simulated payment details for ${app.profile.displayName}`,
    `Fictional username: @${app.profile.username}`,
    `Fictional wallet ID: ${app.profile.walletId}`,
    amount ? `Requested (simulated): ${f.money(amount, main.currency)}` : null,
    'This is a simulation. It cannot receive real money.',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <Page title="Receive">
      <div className="center" style={{ marginTop: 8 }}>
        <Avatar name={app.profile.displayName} color={app.profile.avatarColor} image={app.profile.avatarImage} size={64} />
        <h2 style={{ margin: '10px 0 2px', fontSize: 20 }}>{app.profile.displayName}</h2>
        <div className="muted">@{app.profile.username}</div>
      </div>
      <div style={{ margin: '22px 0 26px' }}>
        <div className="qr-box">
          <QRCode value={payload} label="Demo QR code containing fictional wallet details only" />
          <span className="qr-tag">
            <Badge tone="sim">Demo QR · fictional data</Badge>
          </span>
        </div>
      </div>
      <div className="center">
        <button className="mini-chip" style={{ height: 36, padding: '0 14px' }} onClick={() => openSheet((close) => <AmountSheet currency={main.currency} initial={amountText} onDone={setAmountText} close={close} />, { tall: true })}>
          <Pencil size={14} /> {amount ? `Amount ${f.money(amount, main.currency)}` : 'Add an amount'}
          {amount > 0 && (
            <span
              role="button"
              aria-label="Remove amount"
              onClick={(e) => {
                e.stopPropagation();
                setAmountText('');
              }}
            >
              <X size={14} />
            </span>
          )}
        </button>
      </div>
      <Section title="Fictional wallet details">
        <div className="list">
          <div className="row">
            <div className="row-main">
              <div className="row-sub">Wallet ID (fictional)</div>
              <div className="row-title amount">{app.profile.walletId}</div>
            </div>
            <button
              className="icon-btn"
              aria-label="Copy wallet ID"
              onClick={async () => toast((await copyText(app.profile.walletId)) ? 'Fictional wallet ID copied' : 'Could not copy', 'success')}
            >
              <Copy size={18} />
            </button>
          </div>
          <div className="row">
            <div className="row-main">
              <div className="row-sub">Username</div>
              <div className="row-title">@{app.profile.username}</div>
            </div>
            <button className="icon-btn" aria-label="Copy username" onClick={async () => toast((await copyText(`@${app.profile.username}`)) ? 'Username copied' : 'Could not copy', 'success')}>
              <Copy size={18} />
            </button>
          </div>
          <div className="row">
            <AccountGlyph icon={main.icon} color={main.color} size={36} />
            <div className="row-main">
              <div className="row-sub">Deposits go to</div>
              <div className="row-title">{main.name}</div>
            </div>
          </div>
        </div>
      </Section>
      <div className="stack" style={{ marginTop: 18 }}>
        <Button
          variant="secondary"
          block
          icon={<Share2 size={18} />}
          onClick={async () => {
            const r = await shareText(shareMsg, 'VELTRIX demo details');
            if (r === 'copied') toast('Demo text copied', 'success');
          }}
        >
          Share demo details
        </Button>
        <Button block icon={<ArrowDownLeft size={18} />} onClick={() => openIncomingSheet(main.id)}>
          Simulate incoming payment
        </Button>
      </div>
      <p className="disclaimer">The QR code and wallet ID are fictional and only work inside this simulator. They cannot be used to receive real money.</p>
    </Page>
  );
}
