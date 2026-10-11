import { CircleCheck, Clock, Search, Share2, UserPlus, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES } from '../domain/currency';
import { simRef } from '../domain/ids';
import { CATEGORY_LABEL } from '../domain/labels';
import { availableFunds } from '../domain/ledger';
import { AMOUNT_ERROR_TEXT, parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID, PAYMENT_KINDS } from '../domain/ops/common';
import { createContact } from '../domain/ops/entities';
import { createRequest, resolveRequest, sendFeeFor, sendMoney, type Party } from '../domain/ops/payments';
import { localNice, usernameFrom } from '../domain/presets';
import type { Category, Contact, Txn } from '../domain/types';
import { graphemeLength, NOTE_MAX, normalizeUsername, validateName, validateUsername } from '../domain/validation';
import { shareText } from '../platform/bridge';
import { act, errorText, newOpKey } from '../state/actions';
import { getSnapshot, run, useApp } from '../state/store';
import { nav, toast, useBackInterceptor } from '../state/ui';
import { AccountGlyph, Avatar, CategoryGlyph } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { useFmt } from '../ui/components/Money';
import { pickAccount, pickCategory } from '../ui/components/pickers';
import { Button, Chip, Field, KV, Notice, SearchInput, Section, Steps, Switch, TextArea, TextInput, ToggleRow, TopBar, useScreen } from '../ui/components/primitives';

type Mode = 'send' | 'request';

interface Draft {
  party: Party | null;
  amountText: string;
  accountId: string;
  instant: boolean;
  note: string;
  category: Category;
  pending: boolean;
}

const NOTE_PRESETS = ['Dinner', 'Rent', 'Gift', 'Tickets', 'Groceries', 'Thanks!', 'Trip'];

function partyFromContact(c: Contact): Party {
  return { contactId: c.id, name: c.name, handle: c.username };
}

/* ------------------------------ Step 0 ------------------------------ */

function RecipientStep({ mode, onPick }: { mode: Mode; onPick: (p: Party) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [save, setSave] = useState(true);
  const [err, setErr] = useState<{ name?: string; handle?: string }>({});
  const query = q.trim().toLowerCase();
  const contacts = useMemo(() => [...app.contacts].sort((a, b) => a.name.localeCompare(b.name)), [app.contacts]);
  const matches = query ? contacts.filter((c) => `${c.name} @${c.username} ${c.identifier}`.toLowerCase().includes(query)) : contacts;
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: Party[] = [];
    for (let i = app.transactions.length - 1; i >= 0 && out.length < 6; i--) {
      const t = app.transactions[i];
      if ((t.type === 'send' || t.type === 'receive') && t.counterparty && !t.counterparty.name.includes('(fictional employer)')) {
        const k = t.counterparty.contactId ?? t.counterparty.name;
        if (!seen.has(k)) {
          seen.add(k);
          const c = t.counterparty.contactId ? app.contacts.find((x) => x.id === t.counterparty?.contactId) : undefined;
          if (c) out.push(partyFromContact(c));
          else if (!t.counterparty.contactId) out.push({ name: t.counterparty.name, handle: t.counterparty.handle });
        }
      }
    }
    return out;
  }, [app.transactions, app.contacts]);
  const favorites = contacts.filter((c) => c.favorite);

  const submitNew = () => {
    const e: { name?: string; handle?: string } = {};
    const ne = validateName(name, 'Name');
    if (ne) e.name = ne;
    let uname = normalizeUsername(handle);
    if (uname) {
      const ue = validateUsername(uname);
      if (ue) e.handle = ue;
      else if (save && app.contacts.some((c) => c.username === uname)) e.handle = 'Another contact already uses this username';
    }
    setErr(e);
    if (e.name || e.handle) return;
    if (save) {
      if (!uname) {
        uname = usernameFrom(name);
        let n = 2;
        const base = uname.slice(0, 17);
        while (app.contacts.some((c) => c.username === uname)) uname = `${base}${n++}`;
      }
      const r = run((s, ctx) => createContact(s, { name, username: uname, identifier: '', color: '#7C6CF2', note: '', favorite: false }, ctx));
      if (!r.ok) {
        setErr({ handle: errorText(r) });
        return;
      }
      toast('Fictional contact saved', 'success');
      onPick(partyFromContact(r.contact));
    } else {
      onPick({ name: name.trim(), handle: uname || undefined });
    }
  };

  if (creating) {
    return (
      <div className="scroll">
        <h2 className="page-title">New fictional recipient</h2>
        <Notice>Use made-up people only. VELTRIX never contacts anyone and nothing is sent anywhere.</Notice>
        <div style={{ height: 16 }} />
        <Field label="Name" error={err.name}>
          <TextInput value={name} onChange={setName} placeholder="e.g. Jordan Vale" autoFocus invalid={!!err.name} autoCapitalize="words" />
        </Field>
        <Field label="Fictional username (optional)" error={err.handle} hint="Letters, numbers, dots and underscores">
          <TextInput value={handle} onChange={setHandle} placeholder="@jordan.vale" invalid={!!err.handle} autoCapitalize="none" />
        </Field>
        <div className="list">
          <ToggleRow title="Save to contacts" sub="Keep this fictional person for next time" checked={save} onChange={setSave} />
        </div>
        <div style={{ height: 18 }} />
        <div className="btn-row">
          <Button variant="secondary" onClick={() => setCreating(false)}>
            Back
          </Button>
          <Button onClick={submitNew}>Continue</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll">
      <h2 className="page-title">{mode === 'send' ? 'Who are you paying?' : 'Request from whom?'}</h2>
      <SearchInput value={q} onChange={setQ} placeholder="Search name or @username" icon={<Search size={18} />} />
      <button className="row" style={{ marginTop: 10, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={() => setCreating(true)}>
        <span className="tile-ico" style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)' }}>
          <UserPlus size={20} />
        </span>
        <div className="row-main">
          <div className="row-title">New fictional recipient</div>
          <div className="row-sub">Create a made-up person</div>
        </div>
      </button>
      {query && matches.length === 0 && (
        <button
          className="row"
          style={{ marginTop: 10, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }}
          onClick={() => {
            setName(q.trim());
            setCreating(true);
          }}
        >
          <Avatar name={q} color="#64748B" />
          <div className="row-main">
            <div className="row-title">Use “{q.trim()}”</div>
            <div className="row-sub">As a new fictional recipient</div>
          </div>
        </button>
      )}
      {!query && favorites.length > 0 && (
        <Section title="Favorites">
          <div className="hscroll" style={{ gap: 16 }}>
            {favorites.map((c) => (
              <button key={c.id} className="qa" style={{ flex: '0 0 64px' }} onClick={() => onPick(partyFromContact(c))}>
                <Avatar name={c.name} color={c.color} size={56} />
                <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {!query && recent.length > 0 && (
        <Section title="Recent">
          <div className="list">
            {recent.map((p, i) => {
              const c = p.contactId ? app.contacts.find((x) => x.id === p.contactId) : undefined;
              return (
                <button key={i} className="row" onClick={() => onPick(p)}>
                  <Avatar name={p.name} color={c?.color ?? '#64748B'} />
                  <div className="row-main">
                    <div className="row-title">{p.name}</div>
                    <div className="row-sub">{p.handle ? `@${p.handle}` : 'Not in contacts'}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
      )}
      <Section title={query ? 'Matches' : 'All contacts'}>
        {matches.length ? (
          <div className="list">
            {matches.map((c) => (
              <button key={c.id} className="row" onClick={() => onPick(partyFromContact(c))}>
                <Avatar name={c.name} color={c.color} />
                <div className="row-main">
                  <div className="row-title">{c.name}</div>
                  <div className="row-sub">@{c.username}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          !query && <div className="panel pad muted small center">No contacts yet — create a fictional recipient above.</div>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------ Flow ------------------------------- */

export function PaymentFlow({ mode }: { mode: Mode }) {
  const { route, visible } = useScreen();
  const app = useApp();
  const f = useFmt();
  const initialContact = route.params.contactId ? app.contacts.find((c) => c.id === route.params.contactId) : undefined;
  const defaultAcc = app.accounts.find((a) => a.id === (route.params.accountId ?? app.settings.defaultAccountId) && !a.archived && PAYMENT_KINDS.includes(a.kind)) ?? app.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!;
  const [step, setStep] = useState(initialContact ? 1 : 0);
  const [d, setD] = useState<Draft>(() => ({
    party: initialContact ? partyFromContact(initialContact) : null,
    amountText: route.params.amount ?? '',
    accountId: defaultAcc.id,
    instant: false,
    note: '',
    category: mode === 'send' ? 'transfers' : 'income',
    pending: false,
  }));
  const [opKey] = useState(() => newOpKey(mode));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ txn: Txn; requestId?: string } | null>(null);
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  useBackInterceptor(() => {
    if (step > 0 && step < 4) {
      setStep(step - 1);
      return true;
    }
    return false;
  }, visible);

  const acc = app.accounts.find((a) => a.id === d.accountId) ?? defaultAcc;
  const cur = acc.currency;
  const dec = CURRENCIES[cur].decimals;
  const parsed = d.amountText ? parseAmount(d.amountText, dec) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  const fee = mode === 'send' ? sendFeeFor(app, amount, d.instant) : 0;
  const total = amount + fee;
  const tracked = app.settings.trackBalances;
  const available = availableFunds(acc);
  let amountError: string | null = null;
  if (parsed && !parsed.ok && d.amountText !== '0' && d.amountText !== '0.' && !/^0\.0*$/.test(d.amountText)) amountError = AMOUNT_ERROR_TEXT[parsed.error];
  else if (mode === 'send' && amount > 0 && tracked && !d.pending && total > available) amountError = 'Not enough simulated funds for this amount' + (fee ? ' and fee' : '');
  const noteLen = graphemeLength(d.note);
  const presets = [10, 25, 50, 100].map((u) => localNice(u, cur));

  const confirm = () => {
    if (busy || !d.party) return;
    setBusy(true);
    if (mode === 'send') {
      const r = act((s, ctx) => sendMoney(s, { recipient: d.party, amount, accountId: acc.id, note: d.note, category: d.category, instant: d.instant, outcome: d.pending ? 'pending' : 'completed', opKey }, ctx), { haptics: true });
      setBusy(false);
      if (r.ok) {
        setResult({ txn: r.txn });
        setStep(4);
      }
    } else {
      const r = act((s, ctx) => createRequest(s, { party: d.party, amount, accountId: acc.id, note: d.note, opKey }, ctx));
      setBusy(false);
      if (r.ok) {
        setResult({ txn: r.txn, requestId: r.request.id });
        setStep(4);
      }
    }
  };

  const title = mode === 'send' ? 'Send money' : 'Request money';
  const stepsBar = step < 4 ? <Steps count={4} current={step} /> : null;
  const exitFlow = () => nav.pop();

  const recipientChip = d.party && (
    <button className="mini-chip" style={{ height: 36, padding: '0 12px 0 4px', margin: '0 auto', display: 'flex' }} onClick={() => setStep(0)} aria-label={`Recipient ${d.party.name}, change`}>
      <Avatar name={d.party.name} color={app.contacts.find((c) => c.id === d.party?.contactId)?.color ?? '#64748B'} size={28} />
      <span>
        {mode === 'send' ? 'To ' : 'From '}
        {d.party.name}
      </span>
    </button>
  );

  if (step === 0) {
    return (
      <>
        <TopBar title={title} onBack={exitFlow} />
        {stepsBar}
        <RecipientStep
          mode={mode}
          onPick={(p) => {
            patch({ party: p });
            setStep(1);
          }}
        />
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        <TopBar title={title} onBack={() => setStep(0)} />
        {stepsBar}
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginTop: 6 }}>{recipientChip}</div>
          <div className="amount-entry" style={{ paddingTop: 18 }}>
            <AmountDisplay text={d.amountText} currency={cur} locale={f.locale} invalid={!!amountError} />
            <div className="small" style={{ minHeight: 22, marginTop: 4 }}>
              {amountError ? (
                <span className="neg" role="alert">
                  {amountError}
                </span>
              ) : mode === 'send' ? (
                <span className="muted">
                  {acc.kind === 'credit' ? 'Available credit' : 'Available'} {f.money(available, cur, { sensitive: true })}
                  {!tracked && ' · tracking off'}
                </span>
              ) : (
                <span className="muted">Will be added to {acc.name} when accepted</span>
              )}
            </div>
          </div>
          <button
            className="select-btn"
            style={{ margin: '6px 0 10px' }}
            onClick={async () => {
              const id = await pickAccount(getSnapshot().app!, { current: acc.id, title: mode === 'send' ? 'Pay from' : 'Deposit to', filter: (a) => PAYMENT_KINDS.includes(a.kind) });
              if (id && id !== acc.id) patch({ accountId: id, amountText: '' });
            }}
          >
            <AccountGlyph icon={acc.icon} color={acc.color} size={34} />
            <div className="row-main">
              <div className="row-title">{acc.name}</div>
              <div className="row-sub">
                {mode === 'send' ? 'Pay from' : 'Deposit to'} · {cur}
              </div>
            </div>
            <span className="link-btn">Change</span>
          </button>
          <div className="chips" style={{ justifyContent: 'center', marginBottom: 6 }}>
            {presets.map((p) => (
              <Chip key={p} onClick={() => patch({ amountText: (p / 10 ** dec).toString() })}>
                {f.money(p, cur)}
              </Chip>
            ))}
          </div>
          {mode === 'send' && (
            <div className="row" style={{ padding: '6px 4px', minHeight: 48 }}>
              <Zap size={18} className="warn" />
              <div className="row-main">
                <div className="row-title small">Instant (simulated fee)</div>
                <div className="row-sub xsmall">
                  {d.instant && amount > 0 ? `Fee ${f.money(fee, cur)} · Total ${f.money(total, cur)}` : `${(app.settings.fees.instantSend.bps / 100).toFixed(2)}% · standard is free`}
                </div>
              </div>
              <Switch checked={d.instant} onChange={(v) => patch({ instant: v })} label="Instant simulated transfer" />
            </div>
          )}
          <div style={{ marginTop: 'auto' }}>
            <Keypad value={d.amountText} onChange={(v) => patch({ amountText: v })} currency={cur} active={visible} />
            <Button block onClick={() => setStep(2)} disabled={amount <= 0 || !!amountError}>
              Continue
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <TopBar title={title} onBack={() => setStep(1)} />
        {stepsBar}
        <div className="scroll">
          <div style={{ marginTop: 6 }}>{recipientChip}</div>
          <div className="center" style={{ margin: '12px 0 18px' }}>
            <div className="amount strong" style={{ fontSize: 30, letterSpacing: '-0.03em' }}>
              {f.money(amount, cur)}
            </div>
          </div>
          <Field label="What’s it for? (optional)" counter={`${noteLen}/${NOTE_MAX}`} error={noteLen > NOTE_MAX ? `Keep the note under ${NOTE_MAX} characters` : null}>
            <TextArea value={d.note} onChange={(v) => patch({ note: v })} placeholder="Add a note — emoji welcome" ariaLabel="Note" />
          </Field>
          <div className="chips wrap" style={{ marginBottom: 18 }}>
            {NOTE_PRESETS.map((p) => (
              <Chip key={p} pressed={d.note === p} onClick={() => patch({ note: d.note === p ? '' : p })}>
                {p}
              </Chip>
            ))}
          </div>
          <div className="list">
            {mode === 'send' && (
              <button
                className="row"
                onClick={async () => {
                  const c = await pickCategory(d.category);
                  if (c) patch({ category: c });
                }}
              >
                <CategoryGlyph category={d.category} size={38} />
                <div className="row-main">
                  <div className="row-title">Category</div>
                  <div className="row-sub">{CATEGORY_LABEL[d.category]}</div>
                </div>
                <span className="link-btn">Change</span>
              </button>
            )}
            {mode === 'send' && <ToggleRow title="Leave as pending" sub="Complete or cancel it later from Activity" checked={d.pending} onChange={(v) => patch({ pending: v })} />}
          </div>
        </div>
        <div className="footer-bar">
          <Button block onClick={() => setStep(3)} disabled={noteLen > NOTE_MAX}>
            Review
          </Button>
        </div>
      </>
    );
  }

  if (step === 3) {
    const after = acc.balance - total;
    return (
      <>
        <TopBar title="Review" onBack={() => setStep(2)} />
        {stepsBar}
        <div className="scroll">
          <div className="sim-banner" style={{ marginTop: 6 }}>
            Simulated transaction · no real money moves
          </div>
          <div className="center" style={{ margin: '22px 0 6px' }}>
            {d.party && <Avatar name={d.party.name} color={app.contacts.find((c) => c.id === d.party?.contactId)?.color ?? '#64748B'} size={60} />}
            <div className="muted small" style={{ marginTop: 10 }}>
              {mode === 'send' ? 'You are simulating a payment to' : 'You are requesting from'}
            </div>
            <div className="strong" style={{ fontSize: 18 }}>
              {d.party?.name}
              {d.party?.handle && <span className="muted small"> @{d.party.handle}</span>}
            </div>
            <div className="amount" style={{ fontSize: 40, fontWeight: 720, letterSpacing: '-0.035em', marginTop: 6 }}>
              {f.money(amount, cur)}
            </div>
          </div>
          <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <KV k={mode === 'send' ? 'From' : 'Deposit to'} v={acc.name} />
            {mode === 'send' && <KV k="Simulated fee" v={fee ? f.money(fee, cur) : 'Free'} />}
            {mode === 'send' && <KV k="Total" v={<span className="strong">{f.money(total, cur)}</span>} />}
            {mode === 'send' && tracked && !d.pending && <KV k="Balance after" v={f.money(after, cur, { sensitive: true })} />}
            {d.note && <KV k="Note" v={d.note} />}
            {mode === 'send' && <KV k="Category" v={CATEGORY_LABEL[d.category]} />}
            <KV k="Result" v={mode === 'request' ? 'Pending request' : d.pending ? 'Simulation pending' : 'Simulation completed'} />
          </div>
          {!tracked && mode === 'send' && (
            <Notice tone="warn" style={{ marginTop: 12 }}>
              Balance tracking is off: this will be recorded in Activity without changing any balance.
            </Notice>
          )}
          <p className="disclaimer">This is a fictional simulation inside VELTRIX. Nobody is paid or charged, and no bank or payment network is contacted.</p>
        </div>
        <div className="footer-bar">
          <Button block onClick={confirm} disabled={busy}>
            {busy ? 'Simulating…' : mode === 'send' ? 'Confirm simulation' : 'Create simulated request'}
          </Button>
        </div>
      </>
    );
  }

  // Result
  const t = result?.txn;
  const pending = t?.status === 'pending';
  const summary = t
    ? [
        'VELTRIX SIMULATION — not a real payment',
        mode === 'send' ? `Simulated payment of ${f.money(t.amount, t.currency)} to ${t.title}` : `Simulated request for ${f.money(t.amount, t.currency)} from ${t.title}`,
        `Status: ${pending ? (mode === 'send' ? 'Simulation pending' : 'Request pending') : 'Simulation completed'} · ${simRef(t.id)} · ${f.dateTime(t.createdAt)}`,
        'No real money moved. Created with the VELTRIX Wallet simulator.',
      ].join('\n')
    : '';
  return (
    <>
      <TopBar title="" back={false} right={<button className="icon-btn" aria-label="Close" onClick={exitFlow}><X size={22} /></button>} />
      <div className="scroll">
        <div className="result">
          <div className={`result-ico ${pending ? 'pending' : 'ok'}`}>{pending ? <Clock size={38} /> : <CircleCheck size={40} />}</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{mode === 'request' ? 'Request saved' : pending ? 'Simulation pending' : 'Simulation completed'}</h2>
          <div className="muted">
            {t && (mode === 'send' ? `${f.money(t.amount + t.fee, t.currency)} to ${t.title}` : `${f.money(t.amount, t.currency)} requested from ${t.title}`)}
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>
            {t && `${simRef(t.id)} · Simulated`}
          </div>
        </div>
        {t && (
          <div className="panel pad" style={{ marginTop: 18, paddingTop: 4, paddingBottom: 4 }}>
            <KV k={mode === 'send' ? 'To' : 'From'} v={`${t.title}${t.counterparty?.handle ? ` (@${t.counterparty.handle})` : ''}`} />
            <KV k={mode === 'send' ? 'Paid from' : 'Deposit to'} v={acc.name} />
            <KV k="Amount" v={f.money(t.amount, t.currency)} />
            {mode === 'send' && <KV k="Simulated fee" v={t.fee ? f.money(t.fee, t.currency) : 'Free'} />}
            {t.note && <KV k="Note" v={t.note} />}
            <KV k="Date" v={f.dateTime(t.createdAt)} />
            <KV k="Status" v={mode === 'request' ? (result?.requestId ? 'Request pending' : 'Request accepted') : pending ? 'Simulation pending' : 'Simulation completed'} />
            {mode === 'send' && t.applied && t.balanceAfter !== undefined && <KV k={`${acc.name} balance`} v={f.money(t.balanceAfter, t.currency, { sensitive: true })} />}
          </div>
        )}
        {mode === 'request' && result?.requestId && (
          <Notice style={{ marginTop: 12 }}>The request stays pending until you mark it accepted (adds the money to {acc.name}) or cancel it.</Notice>
        )}
        {pending && mode === 'send' && <Notice style={{ marginTop: 12 }}>Pending simulations don’t move money yet. Complete or cancel it from the entry’s details in Activity.</Notice>}
        <p className="disclaimer center">A fictional simulation — no real money moved and nothing was sent to any bank or payment network.</p>
      </div>
      <div className="footer-bar stack" style={{ gap: 10 }}>
        {mode === 'request' && result?.requestId ? (
          <div className="btn-row">
            <Button
              variant="secondary"
              onClick={() => {
                const r = act((s, ctx) => resolveRequest(s, result.requestId!, 'accept', ctx), { success: 'Marked accepted (simulated)' });
                if (r.ok) setResult({ ...result, requestId: undefined, txn: r.state.transactions.find((x) => x.id === result.txn.id) ?? result.txn });
              }}
            >
              Mark accepted
            </Button>
            <Button variant="secondary" onClick={() => nav.replace('requests')}>
              All requests
            </Button>
          </div>
        ) : (
          <div className="btn-row">
            <Button variant="secondary" onClick={() => t && nav.replace('txn', { id: t.id })}>
              View details
            </Button>
            <Button
              variant="secondary"
              icon={<Share2 size={18} />}
              onClick={async () => {
                const r = await shareText(summary, 'VELTRIX simulation');
                if (r === 'copied') toast('Simulation summary copied', 'success');
              }}
            >
              Share
            </Button>
          </div>
        )}
        <Button block onClick={exitFlow}>
          Done
        </Button>
      </div>
    </>
  );
}

export function SendScreen() {
  return <PaymentFlow mode="send" />;
}

export function RequestScreen() {
  return <PaymentFlow mode="request" />;
}

