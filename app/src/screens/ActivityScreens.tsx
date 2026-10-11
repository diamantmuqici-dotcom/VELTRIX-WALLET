import { ArrowDownUp, Ban, CircleCheck, Download, FileText, Pencil, RotateCcw, Search, Share2, SlidersHorizontal, Tag, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { CURRENCIES } from '../domain/currency';
import { csvFileName } from './fileNames';
import { ledgerToCsv } from '../domain/csv';
import { formatMonthKey } from '../domain/dates';
import { simRef } from '../domain/ids';
import { CATEGORIES, CATEGORY_LABEL, STATUS_LABEL, TXN_TYPE_LABEL, TXN_TYPES, txnTypeLabel } from '../domain/labels';
import { formatRate } from '../domain/fx';
import { ASSET_MAP, formatQty } from '../domain/markets';
import { activeFilterCount, EMPTY_FILTER, filterLedger, groupByMonth, ledgerTotals, SORT_LABEL, type LedgerFilter, type SortOrder } from '../domain/query';
import { cancelPending, canReverse, completePending, deleteTxn, reverseTxn, updateTxnDetails } from '../domain/ops/payments';
import type { TxnStatus, TxnType } from '../domain/types';
import { graphemeLength, NOTE_MAX } from '../domain/validation';
import { saveTextFile, shareText } from '../platform/bridge';
import { act } from '../state/actions';
import { getSnapshot, useApp } from '../state/store';
import { confirm, nav, openSheet, toast } from '../state/ui';
import { TxnGlyph } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { pick, pickCategory, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Chip, EmptyState, Field, KV, Notice, Page, SearchInput, Section, TextArea, TextInput, useScreen } from '../ui/components/primitives';
import { accountName, displayAmount, TxnRow } from './common';

const QUICK_TYPES: Array<{ label: string; types: TxnType[] }> = [
  { label: 'Sent', types: ['send'] },
  { label: 'Received', types: ['receive'] },
  { label: 'Card', types: ['purchase', 'refund'] },
  { label: 'Transfers', types: ['transfer', 'exchange', 'credit_payment'] },
  { label: 'Investing', types: ['invest_buy', 'invest_sell'] },
  { label: 'Adjustments', types: ['adjustment', 'fee'] },
];

const PAGE = 60;

function FilterSheet({ initial, onApply, close }: { initial: LedgerFilter; onApply: (f: LedgerFilter) => void; close: () => void }) {
  const app = getSnapshot().app!;
  const [f, setF] = useState<LedgerFilter>(initial);
  const [minText, setMinText] = useState(initial.minAmount !== null ? String(initial.minAmount) : '');
  const [maxText, setMaxText] = useState(initial.maxAmount !== null ? String(initial.maxAmount) : '');
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const num = (s: string) => {
    const v = Number(s.replace(',', '.'));
    return s.trim() === '' || !Number.isFinite(v) || v < 0 ? null : v;
  };
  const accounts = app.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order);
  return (
    <>
      <SheetHeader title="Filters" onClose={close} />
      <div className="sheet-body">
        <Section title="Type" className="" >
          <div className="chips wrap">
            {TXN_TYPES.map((t) => (
              <Chip key={t} pressed={f.types.includes(t)} onClick={() => setF({ ...f, types: toggle(f.types, t) })}>
                {TXN_TYPE_LABEL[t]}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Status">
          <div className="chips wrap">
            {(['completed', 'pending', 'canceled', 'reversed'] as TxnStatus[]).map((s) => (
              <Chip key={s} pressed={f.statuses.includes(s)} onClick={() => setF({ ...f, statuses: toggle(f.statuses, s) })}>
                {s[0].toUpperCase() + s.slice(1)}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Category">
          <div className="chips wrap">
            {CATEGORIES.map((c) => (
              <Chip key={c} pressed={f.categories.includes(c)} onClick={() => setF({ ...f, categories: toggle(f.categories, c) })}>
                {CATEGORY_LABEL[c]}
              </Chip>
            ))}
          </div>
        </Section>
        <Section title="Account">
          <div className="chips wrap">
            <Chip pressed={!f.accountId} onClick={() => setF({ ...f, accountId: null })}>
              All accounts
            </Chip>
            {accounts.map((a) => (
              <Chip key={a.id} pressed={f.accountId === a.id} onClick={() => setF({ ...f, accountId: a.id })}>
                {a.name}
              </Chip>
            ))}
          </div>
        </Section>
        {app.cards.length > 0 && (
          <Section title="Card">
            <div className="chips wrap">
              <Chip pressed={!f.cardId} onClick={() => setF({ ...f, cardId: null })}>
                Any card
              </Chip>
              {app.cards.map((c) => (
                <Chip key={c.id} pressed={f.cardId === c.id} onClick={() => setF({ ...f, cardId: c.id })}>
                  {c.nickname} ··{c.displayDigits}
                </Chip>
              ))}
            </div>
          </Section>
        )}
        <Section title="Date range">
          <div className="btn-row">
            <Field label="From">
              <input className="input" type="date" value={f.from ?? ''} max={f.to ?? undefined} onChange={(e) => setF({ ...f, from: e.target.value || null })} aria-label="From date" />
            </Field>
            <Field label="To">
              <input className="input" type="date" value={f.to ?? ''} min={f.from ?? undefined} onChange={(e) => setF({ ...f, to: e.target.value || null })} aria-label="To date" />
            </Field>
          </div>
        </Section>
        <Section title="Amount (in each entry’s currency)">
          <div className="btn-row">
            <Field label="Min">
              <TextInput value={minText} onChange={setMinText} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Max">
              <TextInput value={maxText} onChange={setMaxText} inputMode="decimal" placeholder="Any" />
            </Field>
          </div>
        </Section>
      </div>
      <div className="sheet-foot btn-row">
        <Button
          variant="secondary"
          onClick={() => {
            onApply({ ...EMPTY_FILTER, text: initial.text, sort: initial.sort });
            close();
          }}
        >
          Clear all
        </Button>
        <Button
          onClick={() => {
            onApply({ ...f, minAmount: num(minText), maxAmount: num(maxText) });
            close();
          }}
        >
          Apply
        </Button>
      </div>
    </>
  );
}

export function ActivityScreen() {
  const app = useApp();
  const f = useFmt();
  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const results = useMemo(() => filterLedger(app, filter), [app, filter]);
  useEffect(() => setLimit(PAGE), [filter]);
  const groups = useMemo(() => groupByMonth(results.slice(0, limit)), [results, limit]);
  const totals = useMemo(() => ledgerTotals(results, filter.accountId, app.accounts), [results, filter.accountId, app.accounts]);
  const quickActive = (types: TxnType[]) => types.length === filter.types.length && types.every((t) => filter.types.includes(t));
  const nFilters = activeFilterCount(filter);
  const exportCsv = async () => {
    const csv = ledgerToCsv(app, results);
    const r = await saveTextFile(csvFileName(), 'text/csv', csv);
    if (r.ok) toast(`Exported ${results.length} simulated entries`, 'success');
    else if (r.message !== 'canceled') toast('Export failed', 'error');
  };
  return (
    <>
      <header className="topbar" style={{ paddingLeft: 16 }}>
        <h1 className="page-title" style={{ margin: 0, flex: 1 }}>
          Activity
        </h1>
        <button className="icon-btn" aria-label="Export filtered entries as CSV" onClick={exportCsv} disabled={!results.length}>
          <Download size={20} />
        </button>
        <button
          className="icon-btn"
          aria-label={`Sort: ${SORT_LABEL[filter.sort]}`}
          onClick={async () => {
            const s = await pick<SortOrder>('Sort by', (Object.keys(SORT_LABEL) as SortOrder[]).map((k) => ({ value: k, label: SORT_LABEL[k] })), filter.sort);
            if (s) setFilter({ ...filter, sort: s });
          }}
        >
          <ArrowDownUp size={20} />
        </button>
      </header>
      <div className="scroll">
        <SearchInput value={filter.text} onChange={(text) => setFilter({ ...filter, text })} placeholder="Search name, note, amount or SIM ref" icon={<Search size={18} />} />
        <div className="chips" style={{ marginTop: 10 }}>
          <Chip icon={<SlidersHorizontal size={15} />} pressed={nFilters > 0} count={nFilters} onClick={() => openSheet((close) => <FilterSheet initial={filter} onApply={setFilter} close={close} />, { tall: true })}>
            Filters
          </Chip>
          {QUICK_TYPES.map((q) => (
            <Chip key={q.label} pressed={quickActive(q.types)} onClick={() => setFilter({ ...filter, types: quickActive(q.types) ? [] : q.types })}>
              {q.label}
            </Chip>
          ))}
          <Chip pressed={filter.statuses.length === 1 && filter.statuses[0] === 'pending'} onClick={() => setFilter({ ...filter, statuses: filter.statuses[0] === 'pending' && filter.statuses.length === 1 ? [] : ['pending'] })}>
            Pending
          </Chip>
        </div>
        {totals.length > 0 && (
          <div className="panel pad totals-grid" style={{ marginTop: 12, paddingTop: 10, paddingBottom: 10 }}>
            <span className="lbl">Total</span>
            <span className="lbl">In</span>
            <span className="lbl">Out</span>
            <span className="lbl">Net</span>
            {totals.slice(0, 3).map((t) => (
              <Fragment key={t.currency}>
                <span className="strong small">{t.currency}</span>
                <span className="pos amount">{f.money(t.inflow, t.currency, { sign: 'exceptZero', sensitive: true, compact: t.inflow >= 1e9 })}</span>
                <span className="amount">{f.money(-t.outflow, t.currency, { sign: 'exceptZero', sensitive: true, compact: t.outflow >= 1e9 })}</span>
                <span className="amount strong">{f.money(t.net, t.currency, { sign: 'exceptZero', sensitive: true, compact: Math.abs(t.net) >= 1e9 })}</span>
              </Fragment>
            ))}
            {totals.length > 3 && <span className="xsmall faint" style={{ gridColumn: '1 / -1' }}>+{totals.length - 3} more currencies</span>}
          </div>
        )}
        <div className="small muted" style={{ margin: '12px 4px 0' }}>
          {results.length} {results.length === 1 ? 'entry' : 'entries'} · {SORT_LABEL[filter.sort]}
        </div>
        {results.length === 0 ? (
          <EmptyState icon={<FileText size={24} />} title={app.transactions.length ? 'No matching entries' : 'No activity yet'} action={app.transactions.length ? <Button variant="secondary" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>Clear search & filters</Button> : <Button size="sm" onClick={() => nav.push('send')}>Simulate a payment</Button>}>
            {app.transactions.length ? 'Try a different search or remove some filters.' : 'Simulated payments, purchases, transfers and trades will appear here.'}
          </EmptyState>
        ) : (
          groups.map((g) => (
            <div key={g.month}>
              <div className="group-label">
                <span>{formatMonthKey(g.month, f.locale)}</span>
                <span className="faint">{g.items.length}</span>
              </div>
              <div className="list">
                {g.items.map((t) => (
                  <TxnRow key={t.id} t={t} accountId={filter.accountId ?? undefined} />
                ))}
              </div>
            </div>
          ))
        )}
        {results.length > limit && (
          <div style={{ marginTop: 14 }}>
            <Button variant="secondary" block onClick={() => setLimit(limit + PAGE * 2)}>
              Show more ({results.length - limit} remaining)
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

/* --------------------------- Transaction detail --------------------- */

function NoteSheet({ id, initial, close }: { id: string; initial: string; close: () => void }) {
  const [note, setNote] = useState(initial);
  const n = graphemeLength(note);
  return (
    <>
      <SheetHeader title="Edit note" onClose={close} />
      <div className="sheet-body">
        <Field counter={`${n}/${NOTE_MAX}`} error={n > NOTE_MAX ? 'Note is too long' : null}>
          <TextArea value={note} onChange={setNote} placeholder="Add a note" ariaLabel="Note" />
        </Field>
        <p className="disclaimer">Only descriptive details can be edited. Amounts and accounts are part of the simulated history — reverse an entry to undo it.</p>
      </div>
      <div className="sheet-foot">
        <Button
          block
          disabled={n > NOTE_MAX}
          onClick={() => {
            const r = act((s) => updateTxnDetails(s, id, { note }), { success: 'Note saved' });
            if (r.ok) close();
          }}
        >
          Save note
        </Button>
      </div>
    </>
  );
}

function TagsSheet({ id, initial, close }: { id: string; initial: string[]; close: () => void }) {
  const [text, setText] = useState(initial.map((t) => `#${t}`).join(' '));
  return (
    <>
      <SheetHeader title="Tags" onClose={close} />
      <div className="sheet-body">
        <Field label="Tags" hint="Separate with spaces or commas, e.g. #trip #work (max 8)">
          <TextInput value={text} onChange={setText} placeholder="#trip #work" autoCapitalize="none" />
        </Field>
      </div>
      <div className="sheet-foot">
        <Button
          block
          onClick={() => {
            const tags = text.split(/[\s,]+/).filter(Boolean);
            const r = act((s) => updateTxnDetails(s, id, { tags }), { success: 'Tags saved' });
            if (r.ok) close();
          }}
        >
          Save tags
        </Button>
      </div>
    </>
  );
}

export function TxnDetailScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const t = app.transactions.find((x) => x.id === route.params.id);
  if (!t) {
    return (
      <Page title="Details">
        <EmptyState icon={<FileText size={24} />} title="This entry was removed" />
      </Page>
    );
  }
  const amt = displayAmount(t);
  const card = t.cardId ? app.cards.find((c) => c.id === t.cardId) : undefined;
  const dec = CURRENCIES[t.currency].decimals;
  const reversible = canReverse(t);
  const partnerId = t.links?.reversedBy ?? t.links?.reversalOf;
  const request = t.links?.requestId ? app.requests.find((r) => r.id === t.links?.requestId) : undefined;
  const statusTone = t.status === 'completed' ? 'pos' : t.status === 'pending' ? 'sim' : 'muted';
  const summary = [
    'VELTRIX SIMULATION — not a real transaction',
    `${txnTypeLabel(t)}: ${t.title} · ${f.money(amt.minor, amt.currency, { sign: amt.signed ? 'exceptZero' : 'auto' })}`,
    `${STATUS_LABEL[t.status]} · ${simRef(t.id)} · ${f.dateTime(t.createdAt)}`,
    'No real money moved.',
  ].join('\n');

  const doReverse = async () => {
    const ok = await confirm({
      title: 'Reverse this entry?',
      message:
        t.type === 'send' || t.type === 'purchase' || t.type === 'fee'
          ? `A simulated refund of ${f.money(t.amount + t.fee, t.currency)} will be added. The original stays in history, marked as reversed.`
          : 'A matching reversal entry will be added so every balance returns to where it was. The original stays in history, marked as reversed.',
      confirmLabel: 'Reverse',
    });
    if (ok) act((s, ctx) => reverseTxn(s, t.id, ctx), { success: 'Entry reversed (simulated)' });
  };
  const doDelete = async () => {
    const pair = !!partnerId;
    const ok = await confirm({
      title: pair ? 'Remove both entries?' : 'Delete this entry?',
      message: pair ? 'This entry and its reversal cancel each other out, so removing both leaves every balance unchanged.' : 'This entry never changed a balance, so it can be removed without affecting your simulated accounts.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const r = act((s, ctx) => deleteTxn(s, t.id, ctx), { success: pair ? 'Entries removed' : 'Entry deleted' });
    if (r.ok) nav.pop();
  };
  const canDelete = !t.applied || !!partnerId;

  return (
    <Page title="Details">
      <div className="center" style={{ margin: '8px 0 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <TxnGlyph t={t} state={app} size={58} />
        </div>
        <div className="strong" style={{ fontSize: 18, marginTop: 10 }}>
          {t.title}
        </div>
        <div className={`amount${amt.signed && amt.minor > 0 ? ' pos' : ''}`} style={{ fontSize: 36, fontWeight: 720, letterSpacing: '-0.035em', margin: '4px 0 8px', textDecoration: t.status === 'canceled' ? 'line-through' : undefined }}>
          {f.money(amt.minor, amt.currency, { sign: amt.signed ? 'exceptZero' : 'auto' })}
        </div>
        <div className="hstack" style={{ justifyContent: 'center', gap: 6 }}>
          <Badge tone={statusTone}>{STATUS_LABEL[t.status]}</Badge>
          {t.untracked && <Badge tone="muted">Not applied to balance</Badge>}
        </div>
      </div>

      {t.status === 'pending' && (
        <div className="btn-row" style={{ marginBottom: 16 }}>
          <Button variant="secondary" icon={<Ban size={18} />} onClick={() => act((s, ctx) => cancelPending(s, t.id, ctx), { success: 'Simulation canceled' })}>
            Cancel
          </Button>
          <Button icon={<CircleCheck size={18} />} onClick={() => act((s, ctx) => completePending(s, t.id, ctx), { success: 'Simulation completed' })}>
            Complete
          </Button>
        </div>
      )}

      <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <KV k="Type" v={txnTypeLabel(t)} />
        <KV k="Date & time" v={f.dateTime(t.createdAt)} />
        {t.counterparty && <KV k={t.direction === 'in' ? 'From' : 'To'} v={`${t.counterparty.name}${t.counterparty.handle ? ` (@${t.counterparty.handle})` : ''}`} />}
        <KV k={t.direction === 'in' ? 'Account' : t.direction === 'internal' ? 'From account' : 'Paid from'} v={accountName(app, t.accountId)} />
        {t.toAccountId && <KV k="To account" v={accountName(app, t.toAccountId)} />}
        {t.cardId && <KV k="Card" v={card ? `${card.nickname} •••• ${card.displayDigits}` : 'Deleted card'} />}
        {t.fee > 0 && <KV k="Simulated fee" v={f.money(t.fee, t.currency)} />}
        {t.balanceAfter !== undefined && t.applied && <KV k="Balance" v={`${f.money(t.balanceBefore ?? 0, t.currency, { sensitive: true })} → ${f.money(t.balanceAfter, t.currency, { sensitive: true })}`} />}
        {t.toBalanceAfter !== undefined && t.applied && t.toAccountId && (
          <KV k="Destination balance" v={`${f.money(t.toBalanceBefore ?? 0, t.fx ? t.fx.to : t.currency, { sensitive: true })} → ${f.money(t.toBalanceAfter, t.fx ? t.fx.to : t.currency, { sensitive: true })}`} />
        )}
        <KV k="Reference" v={<span className="amount">{simRef(t.id)}</span>} />
        {request && <KV k="Request" v={`${request.direction === 'outgoing' ? 'You requested' : 'They requested'} · ${request.status}`} />}
      </div>

      {t.fx && (
        <Section title="Conversion breakdown">
          <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <KV k="Amount converted" v={f.money(t.fx.sourceAmount, t.fx.from)} />
            <KV k="Simulated fee" v={f.money(t.fee, t.fx.from)} />
            <KV k="Total debited" v={f.money(t.fx.sourceAmount + t.fee, t.fx.from)} />
            <KV k="Rate used" v={`1 ${t.fx.from} = ${formatRate(t.fx.rate, f.locale)} ${t.fx.to}`} />
            <KV k="You received" v={<span className="strong">{f.money(t.fx.targetAmount, t.fx.to)}</span>} />
            <KV k="Rate source" v={t.fx.rateSource === 'demo' ? 'Demo rates (bundled sample)' : t.fx.rateSource === 'live' ? 'Indicative live rates' : 'Cached indicative rates'} />
            <KV k="Rate timestamp" v={f.dateTime(t.fx.rateTimestamp)} />
          </div>
        </Section>
      )}

      {t.trade && (
        <Section title="Simulated order">
          <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <KV k="Instrument" v={ASSET_MAP.get(t.trade.symbol)?.name ?? t.trade.symbol} />
            <KV k="Side" v={t.trade.side === 'buy' ? 'Buy' : 'Sell'} />
            <KV k="Quantity" v={ASSET_MAP.get(t.trade.symbol) ? formatQty(t.trade.quantity, ASSET_MAP.get(t.trade.symbol)!) : t.trade.quantity} />
            <KV k="Demo price" v={`$${t.trade.price}`} />
            <KV k="Order value" v={f.money(t.amount, 'USD')} />
            <KV k="Hypothetical fee" v={f.money(t.fee, 'USD')} />
            {t.trade.realizedPnl !== undefined && <KV k="Realized P&L" v={<span className={t.trade.realizedPnl >= 0 ? 'pos' : 'neg'}>{f.money(t.trade.realizedPnl, 'USD', { sign: 'exceptZero' })}</span>} />}
          </div>
        </Section>
      )}

      <Section title="Notes & tags">
        <div className="list">
          <button className="row" onClick={() => openSheet((close) => <NoteSheet id={t.id} initial={t.note ?? ''} close={close} />)}>
            <Pencil size={18} className="faint" />
            <div className="row-main">
              <div className="row-title">{t.note || 'Add a note'}</div>
              <div className="row-sub">Note</div>
            </div>
          </button>
          <button
            className="row"
            onClick={async () => {
              const c = await pickCategory(t.category);
              if (c) act((s) => updateTxnDetails(s, t.id, { category: c }), { success: 'Category updated' });
            }}
          >
            <SlidersHorizontal size={18} className="faint" />
            <div className="row-main">
              <div className="row-title">{CATEGORY_LABEL[t.category]}</div>
              <div className="row-sub">Category</div>
            </div>
          </button>
          <button className="row" onClick={() => openSheet((close) => <TagsSheet id={t.id} initial={t.tags} close={close} />)}>
            <Tag size={18} className="faint" />
            <div className="row-main">
              <div className="row-title">{t.tags.length ? t.tags.map((x) => `#${x}`).join(' ') : 'Add tags'}</div>
              <div className="row-sub">Tags</div>
            </div>
          </button>
        </div>
      </Section>

      {partnerId && (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" block onClick={() => nav.push('txn', { id: partnerId })}>
            {t.links?.reversedBy ? 'View reversal entry' : 'View original entry'}
          </Button>
        </div>
      )}

      <div className="stack" style={{ marginTop: 18 }}>
        {reversible && (
          <Button variant="secondary" block icon={<RotateCcw size={18} />} onClick={doReverse}>
            {t.type === 'send' || t.type === 'purchase' || t.type === 'fee' ? 'Refund (reverse)' : 'Reverse entry'}
          </Button>
        )}
        <Button
          variant="secondary"
          block
          icon={<Share2 size={18} />}
          onClick={async () => {
            const r = await shareText(summary, 'VELTRIX simulation');
            if (r === 'copied') toast('Summary copied', 'success');
          }}
        >
          Share simulation summary
        </Button>
        {canDelete ? (
          <Button variant="danger" block icon={<Trash2 size={18} />} onClick={doDelete}>
            {partnerId ? 'Remove entry and its reversal' : 'Delete entry'}
          </Button>
        ) : (
          t.subtype !== 'opening' && <Notice>To remove an entry that moved simulated money, reverse it first. The pair can then be removed together without breaking your balances.</Notice>
        )}
      </div>
      <p className="disclaimer">
        Simulated entry · {simRef(t.id)} · amounts in {t.currency} with {dec} decimal{dec === 1 ? '' : 's'}.
      </p>
    </Page>
  );
}
