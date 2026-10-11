import { ArrowDown, ArrowUp, CreditCard, Dices, Pencil, Plus, ShoppingBag, Smartphone, Snowflake, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES } from '../domain/currency';
import { monthKeyOf } from '../domain/dates';
import { CATEGORY_LABEL } from '../domain/labels';
import { availableFunds, cardSpend } from '../domain/ledger';
import { minorToKeypadText, parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID } from '../domain/ops/common';
import { CARD_KINDS, CARD_NETWORKS, CARD_PATTERNS, createCard, deleteCard, moveCard, setCardStatus, sortedCards, updateCard, validateCardInput, type CardInput } from '../domain/ops/entities';
import { purchase } from '../domain/ops/payments';
import type { AppState, Card, Category } from '../domain/types';
import { graphemeLength, NOTE_MAX } from '../domain/validation';
import { act, newOpKey } from '../state/actions';
import { getSnapshot, update, useApp } from '../state/store';
import { confirm, nav, openSheet, toast } from '../state/ui';
import { CARD_ACCENTS, CUSTOM_PRESETS, PATTERN_NAME, STYLE_NAME, STYLE_ORDER } from '../ui/cardStyles';
import { NETWORK_NAME } from '../ui/components/Brand';
import { DemoCard, MaterialSwatch } from '../ui/components/DemoCard';
import { AccountGlyph, CategoryGlyph } from '../ui/components/Glyphs';
import { AmountDisplay, Keypad } from '../ui/components/Keypad';
import { useFmt } from '../ui/components/Money';
import { pickAccount, pickCategory, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Chip, EmptyState, Field, KV, Notice, Page, ProgressBar, Section, Segmented, TextInput, ToggleRow, TopBar, useScreen, tap } from '../ui/components/primitives';
import { TxnRow } from './common';

function useCardFigures(app: AppState, card: Card) {
  const acc = app.accounts.find((a) => a.id === card.accountId);
  const computed = cardSpend(app, card.id, monthKeyOf(new Date()));
  const spent = card.spendOverride ?? computed;
  return { acc, spent, computed };
}

/* -------------------------- Purchase sheet -------------------------- */

const MERCHANTS: Array<[string, Category]> = [
  ['Green Basket Market', 'food'],
  ['Bean & Bloom Café', 'food'],
  ['Metro Transit', 'transport'],
  ['Urban Threads', 'shopping'],
  ['Lumen Cinema', 'entertainment'],
  ['Atlas Air (demo)', 'travel'],
];

function PurchaseSheet({ cardId, close }: { cardId: string; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const card = app.cards.find((c) => c.id === cardId);
  const acc = card ? app.accounts.find((a) => a.id === card.accountId) : undefined;
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<Category>('shopping');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [opKey] = useState(() => newOpKey('purchase'));
  if (!card || !acc) return null;
  const parsed = text ? parseAmount(text, CURRENCIES[acc.currency].decimals) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  const submit = () => {
    const r = act((s, ctx) => purchase(s, { cardId, merchant, amount, category, note, opKey }, ctx), { success: 'Simulated purchase recorded' });
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title={`Simulate a purchase · ${card.nickname}`} onClose={close} />
      <div className="sheet-body">
        {card.status === 'frozen' && <Notice tone="warn">This demo card is frozen, so the simulated purchase will be declined. Unfreeze it first.</Notice>}
        <Field label="Fictional merchant">
          <TextInput value={merchant} onChange={setMerchant} placeholder="e.g. Green Basket Market" autoCapitalize="words" />
        </Field>
        <div className="chips" style={{ marginTop: -6, marginBottom: 12 }}>
          {MERCHANTS.map(([m, c]) => (
            <Chip
              key={m}
              pressed={merchant === m}
              onClick={() => {
                setMerchant(m);
                setCategory(c);
              }}
            >
              {m}
            </Chip>
          ))}
        </div>
        <div className="amount-entry">
          <AmountDisplay text={text} currency={acc.currency} locale={f.locale} />
          <div className="small muted">
            {acc.kind === 'credit' ? 'Available credit' : 'Available'} {f.money(availableFunds(acc), acc.currency, { sensitive: true })}
          </div>
        </div>
        <Keypad value={text} onChange={setText} currency={acc.currency} />
        <button
          className="select-btn"
          style={{ marginTop: 8 }}
          onClick={async () => {
            const c = await pickCategory(category);
            if (c) setCategory(c);
          }}
        >
          <CategoryGlyph category={category} size={34} />
          <div className="row-main">
            <div className="row-title">{CATEGORY_LABEL[category]}</div>
            <div className="row-sub">Category</div>
          </div>
          <span className="link-btn">Change</span>
        </button>
        <div style={{ marginTop: 10 }}>
          <Field counter={`${graphemeLength(note)}/${NOTE_MAX}`}>
            <TextInput value={note} onChange={setNote} placeholder="Note (optional)" />
          </Field>
        </div>
      </div>
      <div className="sheet-foot">
        <Button block onClick={submit} disabled={!merchant.trim() || amount <= 0 || graphemeLength(note) > NOTE_MAX}>
          Simulate {amount > 0 ? f.money(amount, acc.currency) : 'purchase'}
        </Button>
      </div>
    </>
  );
}

export function openPurchaseSheet(cardId: string): void {
  openSheet((close) => <PurchaseSheet cardId={cardId} close={close} />, { tall: true });
}

/* ---------------------------- Card actions -------------------------- */

async function removeCard(card: Card): Promise<void> {
  const ok = await confirm({
    title: `Delete ${card.nickname}?`,
    message: 'The demo card is removed. Its past simulated transactions stay in Activity (labelled “Deleted card”) so your history still adds up.',
    confirmLabel: 'Delete card',
    destructive: true,
  });
  if (!ok) return;
  const r = act((s) => deleteCard(s, card.id), { success: 'Demo card deleted' });
  if (r.ok) nav.popToRoot();
}

function toggleFreeze(card: Card): void {
  act((s) => setCardStatus(s, card.id, card.status === 'frozen' ? 'active' : 'frozen'), { success: card.status === 'frozen' ? 'Card unfrozen' : 'Card frozen — simulated purchases will be declined' });
}

function CardActions({ card }: { card: Card }) {
  const app = useApp();
  const isDefault = app.settings.defaultCardId === card.id;
  const items = [
    { label: card.status === 'frozen' ? 'Unfreeze' : 'Freeze', icon: <Snowflake size={20} />, run: () => toggleFreeze(card) },
    { label: 'Present', icon: <Smartphone size={20} />, run: () => nav.push('cardPresent', { id: card.id }) },
    { label: 'Purchase', icon: <ShoppingBag size={20} />, run: () => openPurchaseSheet(card.id) },
    { label: 'Edit', icon: <Pencil size={20} />, run: () => nav.push('cardEdit', { id: card.id }) },
  ];
  return (
    <>
      <div className="qa-grid" style={{ marginTop: 4 }}>
        {items.map((i) => (
          <button
            key={i.label}
            className="qa"
            onClick={() => {
              tap();
              i.run();
            }}
          >
            <span className="qa-ico" style={i.label === 'Unfreeze' ? { background: 'var(--info-soft)', color: 'var(--info)' } : undefined}>
              {i.icon}
            </span>
            {i.label}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Star size={16} />}
          disabled={isDefault}
          onClick={() => {
            update((s) => ({ ...s, settings: { ...s.settings, defaultCardId: card.id } }));
            toast('Default card updated', 'success');
          }}
        >
          {isDefault ? 'Default card' : 'Make default'}
        </Button>
        <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => void removeCard(card)}>
          Delete
        </Button>
      </div>
    </>
  );
}

function CardSummary({ card }: { card: Card }) {
  const app = useApp();
  const f = useFmt();
  const { acc, spent } = useCardFigures(app, card);
  return (
    <div className="panel pad">
      <div className="hstack" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="strong">{card.nickname}</div>
          <div className="small muted">
            {card.kind[0].toUpperCase() + card.kind.slice(1)} · •••• {card.displayDigits}
          </div>
        </div>
        <Badge tone={card.status === 'frozen' ? 'info' : 'pos'}>{card.status === 'frozen' ? 'Frozen' : 'Active'}</Badge>
      </div>
      {acc && (
        <>
          <div className="divider" />
          <div className="hstack">
            <AccountGlyph icon={acc.icon} color={acc.color} size={34} />
            <div className="row-main">
              <div className="small muted">Linked account</div>
              <div className="strong small">{acc.name}</div>
            </div>
            <div className="row-end">
              <div className="small muted">{acc.kind === 'credit' ? 'Available' : 'Balance'}</div>
              <div className="strong small amount">{f.money(availableFunds(acc), acc.currency, { sensitive: true })}</div>
            </div>
          </div>
          <div className="divider" />
          <div className="hstack small" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="muted">Spent this month{card.spendOverride !== null ? ' (custom)' : ''}</span>
            <span className="amount strong">
              {f.money(spent, acc.currency)}
              {card.spendLimit > 0 && <span className="muted"> / {f.money(card.spendLimit, acc.currency)}</span>}
            </span>
          </div>
          {card.spendLimit > 0 ? <ProgressBar value={spent} max={card.spendLimit} tone="auto" /> : <div className="xsmall faint">No monthly limit set</div>}
        </>
      )}
    </div>
  );
}

/* ----------------------------- Studio ------------------------------- */

export function CardsScreen() {
  const app = useApp();
  const cards = sortedCards(app);
  const [index, setIndex] = useState(() => Math.max(0, cards.findIndex((c) => c.id === app.settings.defaultCardId)));
  const ref = useRef<HTMLDivElement>(null);
  const safeIndex = Math.min(index, Math.max(0, cards.length - 1));
  const card = cards[safeIndex];
  useEffect(() => {
    const el = ref.current;
    if (!el || !el.children[safeIndex]) return;
    const child = el.children[safeIndex] as HTMLElement;
    el.scrollTo({ left: child.offsetLeft - (el.clientWidth - child.clientWidth) / 2, behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (!el || !el.children.length) return;
    const w = (el.children[0] as HTMLElement).clientWidth + 14;
    const i = Math.round(el.scrollLeft / w);
    if (i !== index) setIndex(Math.min(cards.length - 1, Math.max(0, i)));
  };
  const history = useMemo(() => (card ? app.transactions.filter((t) => t.cardId === card.id).slice(-8).reverse() : []), [app.transactions, card]);
  const reorder = () =>
    openSheet((close) => <ReorderSheet close={close} />, { title: 'Reorder cards' });
  return (
    <Page
      title="Card studio"
      right={
        <button className="icon-btn" aria-label="Create demo card" onClick={() => nav.push('cardEdit')}>
          <Plus size={22} />
        </button>
      }
    >
      {cards.length === 0 ? (
        <EmptyState icon={<CreditCard size={26} />} title="Design your first demo card" action={<Button onClick={() => nav.push('cardEdit')}>Create demo card</Button>}>
          Choose a material, pattern and accent. Demo cards are fictional and only work inside VELTRIX.
        </EmptyState>
      ) : (
        <>
          <div className="card-carousel" ref={ref} onScroll={onScroll}>
            {cards.map((c, i) => (
              <button key={c.id} className={`card-slide${i === safeIndex ? '' : ' dim'}`} onClick={() => (i === safeIndex ? nav.push('cardDetail', { id: c.id }) : setIndex(i))} aria-label={`${c.nickname}${i === safeIndex ? ', open details' : ''}`}>
                <DemoCard card={c} />
              </button>
            ))}
          </div>
          {cards.length > 1 && (
            <div className="dots" aria-hidden="true">
              {cards.map((c, i) => (
                <i key={c.id} className={i === safeIndex ? 'on' : ''} />
              ))}
            </div>
          )}
          {card && (
            <>
              <div style={{ marginTop: 18 }}>
                <CardActions card={card} />
              </div>
              <div style={{ marginTop: 18 }}>
                <CardSummary card={card} />
              </div>
              <Section title="Card activity" action={<button className="link-btn" onClick={() => nav.push('cardDetail', { id: card.id })}>Details</button>}>
                {history.length ? (
                  <div className="list">
                    {history.map((t) => (
                      <TxnRow key={t.id} t={t} />
                    ))}
                  </div>
                ) : (
                  <div className="panel pad muted small center">No simulated purchases on this card yet.</div>
                )}
              </Section>
              {cards.length > 1 && (
                <div style={{ marginTop: 16 }}>
                  <Button variant="secondary" block onClick={reorder}>
                    Reorder cards
                  </Button>
                </div>
              )}
            </>
          )}
          <p className="disclaimer">Demo cards show only four display digits and carry a permanent DEMO CARD label. No card number, CVV or real payment credential exists.</p>
        </>
      )}
    </Page>
  );
}

function ReorderSheet({ close }: { close: () => void }) {
  const app = useApp();
  const cards = sortedCards(app);
  return (
    <>
      <SheetHeader title="Reorder cards" onClose={close} />
      <div className="sheet-body">
        <div className="list">
          {cards.map((c, i) => (
            <div key={c.id} className="row">
              <div style={{ width: 64 }}>
                <DemoCard card={c} />
              </div>
              <div className="row-main">
                <div className="row-title">{c.nickname}</div>
                <div className="row-sub">•••• {c.displayDigits}</div>
              </div>
              <button className="icon-btn" aria-label={`Move ${c.nickname} up`} disabled={i === 0} onClick={() => update((s) => moveCard(s, c.id, -1))}>
                <ArrowUp size={18} />
              </button>
              <button className="icon-btn" aria-label={`Move ${c.nickname} down`} disabled={i === cards.length - 1} onClick={() => update((s) => moveCard(s, c.id, 1))}>
                <ArrowDown size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ----------------------------- Detail ------------------------------- */

export function CardDetailScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const card = app.cards.find((c) => c.id === route.params.id);
  const txns = useMemo(() => (card ? app.transactions.filter((t) => t.cardId === card.id).reverse() : []), [app.transactions, card]);
  if (!card) {
    return (
      <Page title="Card">
        <EmptyState icon={<CreditCard size={24} />} title="This demo card no longer exists" />
      </Page>
    );
  }
  const acc = app.accounts.find((a) => a.id === card.accountId);
  return (
    <Page title={card.nickname}>
      <div style={{ margin: '6px 8px 20px' }}>
        <DemoCard card={card} />
      </div>
      <CardActions card={card} />
      <div style={{ marginTop: 18 }}>
        <CardSummary card={card} />
      </div>
      <Section title="Details">
        <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <KV k="Cardholder" v={card.holderName} />
          <KV k="Issuer (fictional)" v={card.issuerName} />
          <KV k="Type" v={card.kind[0].toUpperCase() + card.kind.slice(1)} />
          <KV k="Network style" v={NETWORK_NAME[card.network]} />
          <KV k="Material" v={STYLE_NAME[card.style]} />
          <KV k="Display digits" v={`•••• ${card.displayDigits}`} />
          <KV k="Expiry (fictional)" v={card.showExpiry ? card.expiry : 'Hidden'} />
          <KV k="Monthly limit" v={card.spendLimit > 0 && acc ? f.money(card.spendLimit, acc.currency) : 'None'} />
        </div>
      </Section>
      <Section title={`Card history (${txns.length})`}>
        {txns.length ? (
          <div className="list">
            {txns.map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <div className="panel pad muted small center">No simulated purchases yet.</div>
        )}
      </Section>
    </Page>
  );
}

/* ---------------------------- Presentation -------------------------- */

export function CardPresentScreen() {
  const { route } = useScreen();
  const app = useApp();
  const card = app.cards.find((c) => c.id === route.params.id);
  return (
    <div className="present" onClick={() => nav.pop()}>
      <button
        className="icon-btn"
        aria-label="Close presentation"
        style={{ position: 'absolute', top: 'calc(var(--safe-top) + 10px)', right: 12, color: 'var(--ink-on-dark)' }}
        onClick={(e) => {
          e.stopPropagation();
          nav.pop();
        }}
      >
        <X size={24} />
      </button>
      {card ? (
        <>
          <div className="card-wrap" style={{ maxWidth: 400 }}>
            <DemoCard card={card} animate />
          </div>
          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{card.nickname}</div>
            <div style={{ opacity: 0.7, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              Presentation mode · display only
              <br />
              DEMO CARD — not a payment instrument and cannot be used at a terminal
            </div>
          </div>
        </>
      ) : (
        <div>Card not found</div>
      )}
    </div>
  );
}

/* ------------------------------ Editor ------------------------------ */

function randomDigits4(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => String(x % 10)).join('');
}

function defaultExpiry(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String((d.getFullYear() + 4) % 100).padStart(2, '0')}`;
}

export function CardEditScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const existing = route.params.id ? app.cards.find((c) => c.id === route.params.id) : undefined;
  const [d, setD] = useState<CardInput>(() =>
    existing
      ? { ...existing }
      : {
          nickname: app.cards.length ? `Card ${app.cards.length + 1}` : 'Everyday',
          holderName: app.profile.displayName.toUpperCase().slice(0, 26),
          issuerName: 'VELTRIX',
          style: 'obsidian',
          customFrom: CUSTOM_PRESETS[0][0],
          customTo: CUSTOM_PRESETS[0][1],
          accent: CARD_ACCENTS[0],
          pattern: 'lines',
          network: 'vx',
          kind: 'debit',
          accountId: MAIN_ACCOUNT_ID,
          displayDigits: randomDigits4(),
          expiry: defaultExpiry(),
          showExpiry: true,
          spendLimit: 0,
          spendOverride: null,
        },
  );
  const acc = app.accounts.find((a) => a.id === d.accountId);
  const cur = acc?.currency ?? app.settings.defaultCurrency;
  const dec = CURRENCIES[cur].decimals;
  const [limitText, setLimitText] = useState(() => (d.spendLimit ? minorToKeypadText(d.spendLimit, dec) : ''));
  const [overrideText, setOverrideText] = useState(() => (d.spendOverride !== null ? minorToKeypadText(d.spendOverride, dec) : ''));
  const [showErrors, setShowErrors] = useState(false);
  const patch = (p: Partial<CardInput>) => setD((x) => ({ ...x, ...p }));
  const limitParsed = limitText.trim() ? parseAmount(limitText, dec, { allowZero: true }) : { ok: true as const, minor: 0 };
  const overrideParsed = overrideText.trim() ? parseAmount(overrideText, dec, { allowZero: true }) : null;
  const candidate: CardInput = {
    ...d,
    spendLimit: limitParsed.ok ? limitParsed.minor : -1,
    spendOverride: overrideParsed ? (overrideParsed.ok ? overrideParsed.minor : -1) : null,
  };
  const error = validateCardInput(app, candidate);
  const preview: Card = { ...candidate, id: existing?.id ?? 'preview', status: existing?.status ?? 'active', order: 0, createdAt: '' };
  const save = () => {
    setShowErrors(true);
    if (error) {
      toast(error, 'error');
      return;
    }
    if (existing) {
      const r = act((s) => updateCard(s, existing.id, candidate), { success: 'Demo card updated' });
      if (r.ok) nav.pop();
    } else {
      const r = act((s, ctx) => createCard(s, candidate, ctx), { success: 'Demo card created' });
      if (r.ok) nav.replace('cardDetail', { id: r.card.id });
    }
  };
  return (
    <>
      <TopBar title={existing ? 'Edit demo card' : 'New demo card'} />
      <div style={{ padding: '4px 36px 14px', flexShrink: 0 }}>
        <DemoCard card={preview} />
      </div>
      <div className="scroll" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <Section title="Material" className="" id="material">
          <div className="style-grid">
            {STYLE_ORDER.map((s) => (
              <button key={s} className="style-opt" aria-pressed={d.style === s} onClick={() => patch({ style: s })}>
                <MaterialSwatch card={{ style: s, customFrom: d.customFrom, customTo: d.customTo }} />
                {STYLE_NAME[s]}
              </button>
            ))}
          </div>
          {d.style === 'custom' && (
            <div style={{ marginTop: 14 }}>
              <div className="field-label">Custom gradient</div>
              <div className="swatches">
                {CUSTOM_PRESETS.map(([a, b]) => (
                  <button key={a + b} className="swatch" aria-label={`Gradient ${a} to ${b}`} aria-pressed={d.customFrom === a && d.customTo === b} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} onClick={() => patch({ customFrom: a, customTo: b })} />
                ))}
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <label className="select-btn" style={{ minHeight: 46 }}>
                  <input type="color" value={d.customFrom} onChange={(e) => patch({ customFrom: e.target.value.toLowerCase() })} aria-label="Gradient start color" style={{ width: 28, height: 28, border: 0, background: 'none', padding: 0 }} />
                  <span className="small">Start</span>
                </label>
                <label className="select-btn" style={{ minHeight: 46 }}>
                  <input type="color" value={d.customTo} onChange={(e) => patch({ customTo: e.target.value.toLowerCase() })} aria-label="Gradient end color" style={{ width: 28, height: 28, border: 0, background: 'none', padding: 0 }} />
                  <span className="small">End</span>
                </label>
              </div>
            </div>
          )}
        </Section>
        <Section title="Accent">
          <div className="swatches">
            {CARD_ACCENTS.map((c) => (
              <button key={c} className="swatch" aria-label={`Accent ${c}`} aria-pressed={d.accent === c} style={{ background: c }} onClick={() => patch({ accent: c })} />
            ))}
          </div>
        </Section>
        <Section title="Pattern">
          <div className="chips wrap">
            {CARD_PATTERNS.map((p) => (
              <Chip key={p} pressed={d.pattern === p} onClick={() => patch({ pattern: p })}>
                {PATTERN_NAME[p]}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Network style (fictional)">
          <div className="chips wrap">
            {CARD_NETWORKS.map((n) => (
              <Chip key={n} pressed={d.network === n} onClick={() => patch({ network: n })}>
                {NETWORK_NAME[n]}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Card details">
          <Field label="Nickname" error={showErrors && !d.nickname.trim() ? 'Nickname is required' : null}>
            <TextInput value={d.nickname} onChange={(v) => patch({ nickname: v })} maxLength={40} />
          </Field>
          <Field label="Cardholder name">
            <TextInput value={d.holderName} onChange={(v) => patch({ holderName: v.toUpperCase() })} maxLength={26} autoCapitalize="characters" />
          </Field>
          <Field label="Fictional issuer name" hint="Use a made-up name — never a real bank">
            <TextInput value={d.issuerName} onChange={(v) => patch({ issuerName: v })} maxLength={22} />
          </Field>
          <Field label="Type">
            <Segmented
              value={d.kind}
              label="Card type"
              onChange={(k) => {
                const credit = app.accounts.find((a) => a.kind === 'credit' && !a.archived);
                if (k === 'credit') patch({ kind: k, accountId: credit?.id ?? d.accountId });
                else patch({ kind: k, accountId: acc?.kind === 'credit' ? MAIN_ACCOUNT_ID : d.accountId });
              }}
              options={CARD_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) }))}
            />
          </Field>
          <Field label="Linked account" error={showErrors && error?.includes('account') ? error : null}>
            <button
              className="select-btn"
              onClick={async () => {
                const id = await pickAccount(getSnapshot().app!, {
                  current: d.accountId,
                  title: 'Account charged by this card',
                  filter: (a) => a.kind !== 'investment' && (d.kind === 'credit' ? a.kind === 'credit' : a.kind !== 'credit'),
                });
                if (id) patch({ accountId: id });
              }}
            >
              {acc ? <AccountGlyph icon={acc.icon} color={acc.color} size={34} /> : null}
              <div className="row-main">
                <div className="row-title">{acc?.name ?? 'Choose account'}</div>
                <div className="row-sub">{acc ? `${acc.currency} · ${f.money(availableFunds(acc), acc.currency, { sensitive: true })}` : ''}</div>
              </div>
              <span className="link-btn">Change</span>
            </button>
          </Field>
          {d.kind === 'credit' && !app.accounts.some((a) => a.kind === 'credit' && !a.archived) && (
            <Notice tone="warn">Credit-style cards need a simulated credit account. Create one under Accounts first.</Notice>
          )}
          <div className="btn-row" style={{ alignItems: 'flex-start' }}>
            <Field label="Display digits" error={showErrors && !/^\d{4}$/.test(d.displayDigits) ? 'Exactly 4 digits' : null}>
              <div className="input-wrap">
                <TextInput value={d.displayDigits} onChange={(v) => patch({ displayDigits: v.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" maxLength={4} />
                <button className="icon-btn clear" aria-label="Random digits" onClick={() => patch({ displayDigits: randomDigits4() })}>
                  <Dices size={18} />
                </button>
              </div>
            </Field>
            <Field label="Expiry (MM/YY)" error={showErrors && d.showExpiry && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(d.expiry) ? 'Use MM/YY' : null}>
              <TextInput
                value={d.expiry}
                onChange={(v) => {
                  const digits = v.replace(/\D/g, '').slice(0, 4);
                  patch({ expiry: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
                }}
                inputMode="numeric"
                maxLength={5}
              />
            </Field>
          </div>
          <div className="list" style={{ marginBottom: 16 }}>
            <ToggleRow title="Show expiry on card" checked={d.showExpiry} onChange={(v) => patch({ showExpiry: v })} />
          </div>
          <Field label={`Monthly spending limit (${cur})`} hint="Leave empty for no limit" error={!limitParsed.ok ? 'Enter a valid amount' : null}>
            <TextInput value={limitText} onChange={setLimitText} inputMode="decimal" placeholder="No limit" />
          </Field>
          <Field label={`Displayed monthly spend (${cur})`} hint="Optional override; leave empty to compute it from the ledger" error={overrideParsed && !overrideParsed.ok ? 'Enter a valid amount' : null}>
            <TextInput value={overrideText} onChange={setOverrideText} inputMode="decimal" placeholder="Computed automatically" />
          </Field>
        </Section>
        <p className="disclaimer">Network marks are original VELTRIX designs. Cards never get a full number or CVV, and always show “DEMO CARD”.</p>
      </div>
      <div className="footer-bar">
        <Button block onClick={save}>
          {existing ? 'Save changes' : 'Create demo card'}
        </Button>
      </div>
    </>
  );
}

