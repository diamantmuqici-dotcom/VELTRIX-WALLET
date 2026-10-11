import { Archive, ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUp, Eye, EyeOff, Landmark, Minus, Pencil, Plus, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { accountMonths } from '../domain/analytics';
import { CURRENCIES, isCurrencyCode, type CurrencyCode } from '../domain/currency';
import { addDays, dayKey, formatMonthKey } from '../domain/dates';
import { txnsForAccount } from '../domain/ledger';
import { minorToKeypadText, parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID, PAYMENT_KINDS } from '../domain/ops/common';
import { ACCOUNT_KIND_LABEL, applyCreditEdit, archiveAccount, createAccount, creditFigures, DEFAULT_ACCOUNT_ICON, moveAccount, resolveCreditEdit, updateAccount, type CreditEdit } from '../domain/ops/entities';
import { ACCOUNT_COLORS } from '../domain/presets';
import type { AccountIcon, AccountKind, CreditProfile } from '../domain/types';
import { act } from '../state/actions';
import { update, useApp } from '../state/store';
import { confirm, nav, toast } from '../state/ui';
import { ACCOUNT_ICON, AccountGlyph } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { pickCurrency } from '../ui/components/pickers';
import { Badge, Button, EmptyState, Field, KV, Notice, Page, ProgressBar, Section, Segmented, TextInput, ToggleRow, useScreen } from '../ui/components/primitives';
import { AccountRow, openAdjustSheet, TxnRow } from './common';
import { openIncomingSheet } from './ReceiveScreen';
import { openTransferSheet } from './TransferSheet';

export function AccountsScreen() {
  const app = useApp();
  const f = useFmt();
  const [reorder, setReorder] = useState(false);
  const active = app.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order);
  const archived = app.accounts.filter((a) => a.archived);
  const totals = useMemo(() => {
    const m = new Map<CurrencyCode, number>();
    for (const a of active) m.set(a.currency, (m.get(a.currency) ?? 0) + a.balance);
    return [...m.entries()];
  }, [active]);
  return (
    <Page
      title="Accounts"
      right={
        <button className="icon-btn" aria-label="New account" onClick={() => nav.push('accountEdit')}>
          <Plus size={22} />
        </button>
      }
    >
      <div className="panel pad" style={{ marginTop: 4 }}>
        <div className="xsmall faint" style={{ marginBottom: 6 }}>
          Net simulated balance by currency (credit owed is subtracted)
        </div>
        {totals.map(([cur, v]) => (
          <div key={cur} className="hstack" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
            <span className="muted small">{cur}</span>
            <span className="strong amount">{f.money(v, cur, { sensitive: true })}</span>
          </div>
        ))}
      </div>
      <Section
        title="Your accounts"
        action={
          <button className="link-btn" onClick={() => setReorder(!reorder)}>
            {reorder ? 'Done' : 'Reorder'}
          </button>
        }
      >
        <div className="list">
          {active.map((a, i) =>
            reorder ? (
              <div key={a.id} className="row">
                <AccountGlyph icon={a.icon} color={a.color} />
                <div className="row-main">
                  <div className="row-title">{a.name}</div>
                </div>
                <button className="icon-btn" aria-label={`Move ${a.name} up`} disabled={i === 0} onClick={() => update((s) => moveAccount(s, a.id, -1))}>
                  <ArrowUp size={18} />
                </button>
                <button className="icon-btn" aria-label={`Move ${a.name} down`} disabled={i === active.length - 1} onClick={() => update((s) => moveAccount(s, a.id, 1))}>
                  <ArrowDown size={18} />
                </button>
              </div>
            ) : (
              <AccountRow key={a.id} a={a} sub={`${ACCOUNT_KIND_LABEL[a.kind]} · ${a.currency}${a.showOnDashboard ? '' : ' · hidden on Home'}`} />
            ),
          )}
        </div>
      </Section>
      {archived.length > 0 && (
        <Section title="Archived">
          <div className="list">
            {archived.map((a) => (
              <div key={a.id} className="row">
                <AccountGlyph icon={a.icon} color={a.color} />
                <div className="row-main">
                  <div className="row-title">{a.name}</div>
                  <div className="row-sub">Archived · history kept</div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    update((s) => ({ ...s, accounts: s.accounts.map((x) => (x.id === a.id ? { ...x, archived: false } : x)) }));
                    toast('Account restored', 'success');
                  }}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}
      <p className="disclaimer">All accounts are fictional containers for simulated money. Archiving keeps their history.</p>
    </Page>
  );
}

export function AccountScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const acc = app.accounts.find((a) => a.id === route.params.id);
  const [limit, setLimit] = useState(40);
  const txns = useMemo(() => (acc ? txnsForAccount(app, acc.id).slice().reverse() : []), [app, acc]);
  const months = useMemo(() => (acc ? accountMonths(app, acc.id, 6, new Date()) : []), [app, acc]);
  if (!acc) {
    return (
      <Page title="Account">
        <EmptyState icon={<Landmark size={24} />} title="Account not found" />
      </Page>
    );
  }
  const cf = acc.kind === 'credit' ? creditFigures(acc) : null;
  const hidden = app.settings.hideBalances || acc.hideAmount;
  const doArchive = async () => {
    const ok = await confirm({ title: `Archive ${acc.name}?`, message: 'Archived accounts disappear from pickers and Home. Their history stays in Activity and you can restore them later.', confirmLabel: 'Archive' });
    if (!ok) return;
    const r = act((s) => archiveAccount(s, acc.id), { success: 'Account archived' });
    if (r.ok) nav.pop();
  };
  return (
    <Page
      title={acc.name}
      right={
        <button className="icon-btn" aria-label="Edit account" onClick={() => nav.push('accountEdit', { id: acc.id })}>
          <Settings2 size={20} />
        </button>
      }
    >
      <div className="hero" style={{ marginTop: 4 }}>
        <div className="hero-top">
          <AccountGlyph icon={acc.icon} color={acc.color} size={30} />
          <span>{ACCOUNT_KIND_LABEL[acc.kind]}</span>
          <Badge tone="sim">Simulated</Badge>
          <span className="spacer" />
          <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={acc.hideAmount ? 'Show this balance' : 'Hide this balance'} onClick={() => act((s) => updateAccount(s, acc.id, { hideAmount: !acc.hideAmount }))}>
            {acc.hideAmount ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <div className="hero-amount" style={{ fontSize: 36 }}>
          <span className="amount">{hidden ? `${CURRENCIES[acc.currency].symbol} ••••••` : f.money(cf ? cf.used : acc.balance, acc.currency)}</span>
        </div>
        <div className="hero-sub">{cf ? 'Used credit (amount owed)' : `${acc.currency} balance`}</div>
        <div className="hero-actions" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {cf ? (
            <>
              <button className="hero-act" onClick={() => openTransferSheet({ toId: acc.id })}>
                <ArrowDownLeft size={16} /> Pay
              </button>
              <button className="hero-act" onClick={() => nav.push('credit', { id: acc.id })}>
                <Pencil size={15} /> Edit
              </button>
              <button className="hero-act" onClick={() => openAdjustSheet('remove', acc.id)}>
                <Plus size={16} /> Charge
              </button>
            </>
          ) : (
            <>
              <button className="hero-act" onClick={() => openAdjustSheet('add', acc.id)}>
                <Plus size={16} /> Add
              </button>
              <button className="hero-act" onClick={() => openAdjustSheet('remove', acc.id)}>
                <Minus size={16} /> Remove
              </button>
              <button className="hero-act" onClick={() => openTransferSheet({ fromId: acc.id })}>
                <ArrowLeftRight size={15} /> Move
              </button>
            </>
          )}
        </div>
      </div>

      {cf && acc.credit && (
        <Section title="Credit overview (fictional)">
          <div className="panel pad">
            <div className="hstack small" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="muted">Utilization</span>
              <span className="strong">{cf.utilization.toFixed(1)}%</span>
            </div>
            <ProgressBar value={cf.used} max={cf.limit} tone="auto" />
            <div style={{ marginTop: 6 }}>
              <KV k="Credit limit" v={f.money(cf.limit, acc.currency, { sensitive: true })} />
              <KV k="Available" v={f.money(cf.available, acc.currency, { sensitive: true })} />
              <KV k="Used" v={f.money(cf.used, acc.currency, { sensitive: true })} />
              <KV k="Statement balance" v={f.money(cf.statementBalance, acc.currency, { sensitive: true })} />
              <KV k="Minimum due" v={f.money(cf.minimumDue, acc.currency, { sensitive: true })} />
              <KV k="Payment due" v={cf.dueDate ? f.day(new Date(cf.dueDate + 'T12:00:00').toISOString()) : '—'} />
            </div>
          </div>
          <p className="disclaimer">A fictional credit line for simulation. Not a credit offer, credit report or approval.</p>
        </Section>
      )}

      {!cf && PAYMENT_KINDS.includes(acc.kind) && (
        <div className="btn-row" style={{ marginTop: 14 }}>
          <Button variant="secondary" size="sm" icon={<ArrowDownLeft size={16} />} onClick={() => openIncomingSheet(acc.id)}>
            Simulate incoming
          </Button>
          <Button variant="secondary" size="sm" onClick={() => nav.push('send', { accountId: acc.id })}>
            Send from here
          </Button>
        </div>
      )}

      <Section title="Monthly summary">
        <div className="list">
          {months.map((m) => (
            <div key={m.month} className="row" style={{ minHeight: 0, padding: '10px 14px' }}>
              <div className="row-main">
                <div className="row-title small">{formatMonthKey(m.month, f.locale)}</div>
                <div className="row-sub xsmall">
                  In {f.money(m.inflow, acc.currency, { sensitive: true })} · Out {f.money(m.outflow, acc.currency, { sensitive: true })} · {m.count} entries
                </div>
              </div>
              <div className="row-end">
                <div className={`row-title small amount ${m.net > 0 ? 'pos' : ''}`}>{f.money(m.net, acc.currency, { sign: 'exceptZero', sensitive: true })}</div>
                <div className="row-sub xsmall">closing {f.money(m.closing, acc.currency, { sensitive: true })}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`History (${txns.length})`}>
        {txns.length ? (
          <div className="list">
            {txns.slice(0, limit).map((t) => (
              <TxnRow key={t.id} t={t} accountId={acc.id} />
            ))}
          </div>
        ) : (
          <div className="panel pad muted small center">No entries yet.</div>
        )}
        {txns.length > limit && (
          <div style={{ marginTop: 10 }}>
            <Button variant="secondary" block onClick={() => setLimit(limit + 80)}>
              Show more
            </Button>
          </div>
        )}
      </Section>
      {acc.id !== MAIN_ACCOUNT_ID && (
        <div style={{ marginTop: 18 }}>
          <Button variant="danger" block icon={<Archive size={18} />} onClick={doArchive}>
            Archive account
          </Button>
        </div>
      )}
    </Page>
  );
}

const ICONS = Object.keys(ACCOUNT_ICON) as AccountIcon[];
const KINDS: AccountKind[] = ['checking', 'savings', 'card', 'foreign', 'investment', 'credit', 'wallet'];

export function AccountEditScreen() {
  const { route } = useScreen();
  const app = useApp();
  const existing = route.params.id ? app.accounts.find((a) => a.id === route.params.id) : undefined;
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? (route.params.kind as AccountKind) ?? 'savings');
  const [name, setName] = useState(existing?.name ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(existing?.currency ?? (isCurrencyCode(route.params.currency) ? route.params.currency : app.settings.defaultCurrency));
  const [icon, setIcon] = useState<AccountIcon>(existing?.icon ?? DEFAULT_ACCOUNT_ICON[kind]);
  const [color, setColor] = useState(existing?.color ?? ACCOUNT_COLORS[app.accounts.length % ACCOUNT_COLORS.length]);
  const [show, setShow] = useState(existing?.showOnDashboard ?? true);
  const [opening, setOpening] = useState('');
  const [limitText, setLimitText] = useState('5000');
  const [err, setErr] = useState<string | null>(null);
  const dec = CURRENCIES[currency].decimals;
  const investmentExists = app.accounts.some((a) => a.kind === 'investment' && !a.archived && a.id !== existing?.id);
  const save = () => {
    if (existing) {
      const r = act((s) => updateAccount(s, existing.id, { name, color, icon, showOnDashboard: show }), { success: 'Account updated' });
      if (r.ok) nav.pop();
      else setErr(r.detail ?? null);
      return;
    }
    const op = opening.trim() ? parseAmount(opening, dec, { allowZero: true }) : { ok: true as const, minor: 0 };
    if (!op.ok) {
      setErr('Enter a valid opening amount');
      return;
    }
    let credit: CreditProfile | undefined;
    if (kind === 'credit') {
      const l = parseAmount(limitText, dec);
      if (!l.ok) {
        setErr('Enter a valid credit limit');
        return;
      }
      credit = { limit: l.minor, statementBalance: Math.min(op.minor, l.minor), dueDate: dayKey(addDays(new Date(), 21)) };
    }
    const cur = kind === 'investment' ? 'USD' : currency;
    const r = act((s, ctx) => createAccount(s, { kind, name: name || ACCOUNT_KIND_LABEL[kind], currency: cur, opening: op.minor, color, icon, showOnDashboard: show, credit }, ctx), { success: 'Account created' });
    if (r.ok) nav.replace('account', { id: r.account.id });
    else setErr(r.detail ?? null);
  };
  return (
    <Page
      title={existing ? 'Edit account' : 'New account'}
      footer={
        <Button block onClick={save} disabled={!existing && kind === 'investment' && investmentExists}>
          {existing ? 'Save' : 'Create account'}
        </Button>
      }
    >
      <div className="center" style={{ margin: '6px 0 16px' }}>
        <div style={{ display: 'inline-block' }}>
          <AccountGlyph icon={icon} color={color} size={64} />
        </div>
      </div>
      {!existing && (
        <Field label="Account type">
          <div className="chips wrap">
            {KINDS.map((k) => (
              <button
                key={k}
                className="chip"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setIcon(DEFAULT_ACCOUNT_ICON[k]);
                  if (k === 'investment') setCurrency('USD');
                }}
              >
                {ACCOUNT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
      )}
      {!existing && kind === 'investment' && investmentExists && <Notice tone="warn">You already have an investment account. The market simulator uses a single USD investment account.</Notice>}
      <Field label="Name" error={err}>
        <TextInput value={name} onChange={setName} placeholder={ACCOUNT_KIND_LABEL[kind]} maxLength={40} autoCapitalize="words" />
      </Field>
      {!existing && kind !== 'investment' && (
        <Field label="Currency">
          <button
            className="select-btn"
            onClick={async () => {
              const c = await pickCurrency(currency);
              if (c) setCurrency(c);
            }}
          >
            <div className="row-main">
              <div className="row-title">{CURRENCIES[currency].name}</div>
              <div className="row-sub">{currency}</div>
            </div>
            <span className="link-btn">Change</span>
          </button>
        </Field>
      )}
      {!existing && (
        <Field label={kind === 'credit' ? `Already used (${currency})` : `Opening balance (${kind === 'investment' ? 'USD' : currency})`} hint="Recorded as an “Opening balance” entry in the ledger">
          <TextInput value={opening} onChange={setOpening} inputMode="decimal" placeholder="0" />
        </Field>
      )}
      {!existing && kind === 'credit' && (
        <Field label={`Credit limit (${currency})`} hint="Fictional limit — you can edit all credit figures later">
          <TextInput value={limitText} onChange={setLimitText} inputMode="decimal" />
        </Field>
      )}
      <Field label="Icon">
        <div className="chips wrap">
          {ICONS.map((i) => {
            const I = ACCOUNT_ICON[i];
            return (
              <button key={i} className="chip" aria-pressed={icon === i} aria-label={i} onClick={() => setIcon(i)} style={{ width: 44, padding: 0, justifyContent: 'center' }}>
                <I size={18} />
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Color">
        <div className="swatches">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} className="swatch" aria-label={`Color ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </Field>
      <div className="list">
        <ToggleRow title="Show on Home" sub="Display this account as a tile on the dashboard" checked={show} onChange={setShow} />
      </div>
      {existing?.kind === 'credit' && (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" block onClick={() => nav.push('credit', { id: existing.id })}>
            Edit credit figures
          </Button>
        </div>
      )}
    </Page>
  );
}

export function CreditScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const acc = app.accounts.find((a) => a.id === route.params.id && a.kind === 'credit');
  const dec = acc ? CURRENCIES[acc.currency].decimals : 2;
  const cf = acc ? creditFigures(acc) : null;
  const [limitT, setLimitT] = useState(cf ? minorToKeypadText(cf.limit, dec) : '');
  const [driver, setDriver] = useState<CreditEdit['driver']>('used');
  const [usedT, setUsedT] = useState(cf ? minorToKeypadText(cf.used, dec) || '0' : '0');
  const [availT, setAvailT] = useState(cf ? minorToKeypadText(cf.available, dec) || '0' : '0');
  const [utilT, setUtilT] = useState(cf ? String(cf.utilization) : '0');
  const [stmtT, setStmtT] = useState(cf ? minorToKeypadText(cf.statementBalance, dec) || '0' : '0');
  const [due, setDue] = useState(cf?.dueDate ?? dayKey(addDays(new Date(), 21)));
  if (!acc || !cf) {
    return (
      <Page title="Credit">
        <EmptyState icon={<Landmark size={24} />} title="Credit account not found" />
      </Page>
    );
  }
  const amt = (t: string) => {
    const r = parseAmount(t || '0', dec, { allowZero: true });
    return r.ok ? r.minor : NaN;
  };
  const edit: CreditEdit = { limit: amt(limitT), driver, used: amt(usedT), available: amt(availT), utilization: Number(utilT.replace(',', '.')), statementBalance: amt(stmtT), dueDate: due };
  const res = resolveCreditEdit(edit);
  const derivedUsed = res.ok ? res.used : null;
  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : f.money(v, acc.currency));
  const save = () => {
    const r = act((s, ctx) => applyCreditEdit(s, acc.id, edit, ctx), { success: 'Credit figures saved' });
    if (r.ok) nav.pop();
  };
  return (
    <Page title="Edit credit (fictional)" footer={<Button block onClick={save} disabled={!res.ok}>Save credit figures</Button>}>
      <Notice>Fictional figures for simulation only. Changing “used” credit records a visible adjustment in the ledger.</Notice>
      <div style={{ height: 14 }} />
      <Field label={`Credit limit (${acc.currency})`}>
        <TextInput value={limitT} onChange={setLimitT} inputMode="decimal" />
      </Field>
      <Field label="Edit by">
        <Segmented
          value={driver}
          onChange={setDriver}
          label="Field to edit"
          options={[
            { value: 'used', label: 'Used' },
            { value: 'available', label: 'Available' },
            { value: 'utilization', label: 'Utilization %' },
          ]}
        />
      </Field>
      {driver === 'used' && (
        <Field label={`Used (${acc.currency})`}>
          <TextInput value={usedT} onChange={setUsedT} inputMode="decimal" />
        </Field>
      )}
      {driver === 'available' && (
        <Field label={`Available (${acc.currency})`}>
          <TextInput value={availT} onChange={setAvailT} inputMode="decimal" />
        </Field>
      )}
      {driver === 'utilization' && (
        <Field label="Utilization (%)">
          <TextInput value={utilT} onChange={setUtilT} inputMode="decimal" />
        </Field>
      )}
      <div className="panel pad" style={{ marginBottom: 16, paddingTop: 4, paddingBottom: 4 }}>
        <KV k="Used" v={fmt(derivedUsed)} />
        <KV k="Available" v={fmt(res.ok ? res.limit - res.used : null)} />
        <KV k="Utilization" v={res.ok ? `${((res.used / res.limit) * 100).toFixed(1)}%` : '—'} />
      </div>
      <Field label={`Statement balance (${acc.currency})`}>
        <TextInput value={stmtT} onChange={setStmtT} inputMode="decimal" />
      </Field>
      <Field label="Payment due date">
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Payment due date" />
      </Field>
      {!res.ok && <Notice tone="error">{res.message}</Notice>}
    </Page>
  );
}
