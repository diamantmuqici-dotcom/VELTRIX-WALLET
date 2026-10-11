import { ArrowDownUp, ChevronDown, ExternalLink, Globe, RefreshCw, Star, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CURRENCIES, isCurrencyCode, type CurrencyCode } from '../domain/currency';
import { crossRate, describeRates, formatRate, LIVE_PROVIDER_URL } from '../domain/fx';
import { computeFee, convertMinor, parseAmount } from '../domain/money';
import { exchange, quoteExchange } from '../domain/ops/payments';
import type { AppState, RateSnapshot } from '../domain/types';
import { openExternal } from '../platform/bridge';
import { act, newOpKey } from '../state/actions';
import { refreshLiveRates, useRates } from '../state/rates';
import { getSnapshot, update, useApp } from '../state/store';
import { nav, openSheet, toast } from '../state/ui';
import { AccountGlyph, CurrencyBadge } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { pickAccount, pickCurrency, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Chip, KV, Notice, Page, Section, Switch, TextInput, ToggleRow, useScreen } from '../ui/components/primitives';
import { TxnRow } from './common';

function ExchangeSheet({ from, to, amount, snapshot, close }: { from: CurrencyCode; to: CurrencyCode; amount: number; snapshot: RateSnapshot; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const fromAccounts = app.accounts.filter((a) => !a.archived && a.currency === from && a.kind !== 'credit');
  const toAccounts = app.accounts.filter((a) => !a.archived && a.currency === to && a.kind !== 'credit');
  const [fromId, setFromId] = useState(fromAccounts.sort((a, b) => b.balance - a.balance)[0]?.id ?? '');
  const [toId, setToId] = useState(toAccounts[0]?.id ?? '');
  const [opKey] = useState(() => newOpKey('fx'));
  const fromAcc = app.accounts.find((a) => a.id === fromId);
  const toAcc = app.accounts.find((a) => a.id === toId);
  const rate = crossRate(snapshot, from, to);
  const q = quoteExchange(app, from, to, amount, rate);
  const confirmIt = () => {
    const r = act(
      (s, ctx) => exchange(s, { fromId, toId, amount, rate, rateSource: snapshot.kind, rateTimestamp: snapshot.publishedAt, opKey }, ctx),
      { success: 'Simulated conversion completed' },
    );
    if (r.ok) {
      close();
      nav.push('txn', { id: r.txn.id });
    }
  };
  const missing = !fromAccounts.length ? from : !toAccounts.length ? to : null;
  return (
    <>
      <SheetHeader title="Simulate conversion" onClose={close} />
      <div className="sheet-body">
        <div className="sim-banner">Simulated exchange · no real money moves</div>
        {missing ? (
          <div style={{ marginTop: 14 }}>
            <Notice tone="warn">You don’t have a {missing} balance yet. Create a fictional {missing} currency account to receive or send {missing}.</Notice>
            <div style={{ marginTop: 12 }}>
              <Button
                block
                onClick={() => {
                  close();
                  nav.push('accountEdit', { currency: missing, kind: 'foreign' });
                }}
              >
                Create {missing} balance
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="list" style={{ marginTop: 12 }}>
              <button
                className="row"
                onClick={async () => {
                  const id = await pickAccount(getSnapshot().app as AppState, { current: fromId, title: `Sell ${from} from`, filter: (a) => a.currency === from && a.kind !== 'credit' });
                  if (id) setFromId(id);
                }}
              >
                {fromAcc && <AccountGlyph icon={fromAcc.icon} color={fromAcc.color} size={36} />}
                <div className="row-main">
                  <div className="row-sub">From</div>
                  <div className="row-title">{fromAcc?.name}</div>
                </div>
                <div className="row-end small muted amount">{fromAcc && f.money(fromAcc.balance, from, { sensitive: true })}</div>
              </button>
              <button
                className="row"
                onClick={async () => {
                  const id = await pickAccount(getSnapshot().app as AppState, { current: toId, title: `Receive ${to} in`, filter: (a) => a.currency === to && a.kind !== 'credit' });
                  if (id) setToId(id);
                }}
              >
                {toAcc && <AccountGlyph icon={toAcc.icon} color={toAcc.color} size={36} />}
                <div className="row-main">
                  <div className="row-sub">To</div>
                  <div className="row-title">{toAcc?.name}</div>
                </div>
                <div className="row-end small muted amount">{toAcc && f.money(toAcc.balance, to, { sensitive: true })}</div>
              </button>
            </div>
            <Section title="Calculation">
              {'error' in q ? (
                <Notice tone="error">{q.error === 'amount_too_small' ? 'The amount is too small to convert.' : 'No valid rate for this pair.'}</Notice>
              ) : (
                <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
                  <KV k="Amount" v={f.money(q.amount, from)} />
                  <KV k={`Simulated fee (${(app.settings.fees.exchange.bps / 100).toFixed(2)}%)`} v={f.money(q.fee, from)} />
                  <KV k="Total debited" v={<span className="strong">{f.money(q.totalDebit, from)}</span>} />
                  <KV k="Rate" v={`1 ${from} = ${formatRate(q.rate, f.locale)} ${to}`} />
                  <KV k="Calculation" v={`${f.money(q.amount, from)} × ${formatRate(q.rate, f.locale)}`} />
                  <KV k="You receive" v={<span className="strong pos">{f.money(q.converted, to)}</span>} />
                  <KV k="Rate source" v={snapshot.kind === 'demo' ? 'Demo rates (not live)' : `${snapshot.provider} · indicative`} />
                </div>
              )}
            </Section>
            {fromAcc && !('error' in q) && app.settings.trackBalances && fromAcc.balance < q.totalDebit && <Notice tone="error" style={{ marginTop: 12 }}>Not enough simulated {from} in {fromAcc.name}.</Notice>}
          </>
        )}
      </div>
      {!missing && (
        <div className="sheet-foot">
          <Button block onClick={confirmIt} disabled={'error' in q || !fromAcc || !toAcc}>
            Confirm simulated conversion
          </Button>
        </div>
      )}
    </>
  );
}

export function ExchangeScreen() {
  const { route, visible } = useScreen();
  const app = useApp();
  const f = useFmt();
  const fav0 = app.fx.favorites[0];
  const [from, setFrom] = useState<CurrencyCode>(isCurrencyCode(route.params.from) ? route.params.from : fav0?.[0] ?? app.settings.defaultCurrency);
  const [to, setTo] = useState<CurrencyCode>(isCurrencyCode(route.params.to) ? route.params.to : fav0?.[1] ?? (app.settings.defaultCurrency === 'EUR' ? 'USD' : 'EUR'));
  const [text, setText] = useState('100');
  const [withFee, setWithFee] = useState(false);
  const { snapshot, status } = useRates(app.settings.liveRates, app.fx.liveCache);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const info = describeRates(snapshot, new Date(), online && status.status !== 'error', (iso) => f.dateTime(iso));
  const rate = crossRate(snapshot, from, to);
  const parsed = text ? parseAmount(text, CURRENCIES[from].decimals) : null;
  const amount = parsed?.ok ? parsed.minor : 0;
  const converted = rate && amount > 0 ? convertMinor(amount, CURRENCIES[from].decimals, CURRENCIES[to].decimals, rate) : 0;
  const fee = withFee ? computeFee(amount, app.settings.fees.exchange) : 0;
  const isFav = app.fx.favorites.some(([a, b]) => a === from && b === to);
  const recentExchanges = useMemo(() => app.transactions.filter((t) => t.type === 'exchange').slice(-5).reverse(), [app.transactions]);

  // Remember lookups (debounced) for the conversion history.
  useEffect(() => {
    if (!visible || !rate || amount <= 0 || from === to) return;
    const t = setTimeout(() => {
      update((s) => {
        const last = s.fx.lookups[0];
        if (last && last.from === from && last.to === to && last.amount === amount) return s;
        const entry = { id: `lk_${Date.now().toString(36)}`, from, to, amount, result: converted, rate, rateSource: snapshot.kind, createdAt: new Date().toISOString() };
        return { ...s, fx: { ...s.fx, lookups: [entry, ...s.fx.lookups].slice(0, 30) } };
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [visible, rate, amount, from, to, converted, snapshot.kind]);

  const toggleFav = () => {
    update((s) => ({
      ...s,
      fx: { ...s.fx, favorites: isFav ? s.fx.favorites.filter(([a, b]) => !(a === from && b === to)) : [[from, to] as [CurrencyCode, CurrencyCode], ...s.fx.favorites].slice(0, 8) },
    }));
    toast(isFav ? 'Removed from favorites' : 'Pair added to favorites', 'success');
  };

  return (
    <Page title="Exchange">
      <div className={`notice${info.kind === 'demo' || info.kind === 'stale' ? ' warn' : ''}`}>
        {info.kind === 'demo' ? <Globe size={18} /> : <Wifi size={18} />}
        <div style={{ flex: 1 }}>
          <div className="strong">
            {info.title} <Badge tone={info.kind === 'live' ? 'info' : 'sim'}>{info.kind === 'demo' ? 'Demo' : 'Indicative'}</Badge>
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>
            {info.detail}
          </div>
          {status.error && app.settings.liveRates && <div className="small neg" style={{ marginTop: 4 }}>{status.error}</div>}
          {snapshot.kind !== 'demo' && (
            <button className="link-btn" style={{ paddingLeft: 0 }} onClick={() => openExternal(LIVE_PROVIDER_URL)}>
              Rates by ExchangeRate-API <ExternalLink size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        <ToggleRow
          title="Live indicative rates"
          sub={app.settings.liveRates ? 'Fetched from ExchangeRate-API (open access). Needs internet.' : 'Off — using bundled demo rates. Turn on to fetch indicative rates.'}
          checked={app.settings.liveRates}
          onChange={(v) => {
            update((s) => ({ ...s, settings: { ...s.settings, liveRates: v } }));
            if (v) setTimeout(() => void refreshLiveRates(true), 0);
          }}
        />
        {app.settings.liveRates && (
          <button className="row" onClick={() => void refreshLiveRates(true)} disabled={status.status === 'loading'}>
            <RefreshCw size={18} className="faint" />
            <div className="row-main">
              <div className="row-title">{status.status === 'loading' ? 'Refreshing…' : 'Refresh rates'}</div>
            </div>
          </button>
        )}
      </div>

      <div className="panel pad" style={{ marginTop: 16 }}>
        <div className="field-label">You convert</div>
        <div className="hstack">
          <button
            className="mini-chip"
            style={{ height: 44, padding: '0 10px 0 6px', fontSize: 15 }}
            onClick={async () => {
              const c = await pickCurrency(from, 'Convert from');
              if (c) setFrom(c);
            }}
          >
            <CurrencyBadge code={from} size={30} /> {from} <ChevronDown size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <TextInput value={text} onChange={(v) => setText(v.replace(/[^\d.,]/g, ''))} inputMode="decimal" ariaLabel={`Amount in ${from}`} invalid={!!parsed && !parsed.ok} />
          </div>
        </div>
        <div className="hstack" style={{ justifyContent: 'center', margin: '6px 0' }}>
          <button
            className="icon-btn filled"
            aria-label="Swap currencies"
            onClick={() => {
              setFrom(to);
              setTo(from);
              if (converted > 0) setText(String(converted / 10 ** CURRENCIES[to].decimals));
            }}
          >
            <ArrowDownUp size={18} />
          </button>
        </div>
        <div className="field-label">You get</div>
        <div className="hstack">
          <button
            className="mini-chip"
            style={{ height: 44, padding: '0 10px 0 6px', fontSize: 15 }}
            onClick={async () => {
              const c = await pickCurrency(to, 'Convert to');
              if (c) setTo(c);
            }}
          >
            <CurrencyBadge code={to} size={30} /> {to} <ChevronDown size={16} />
          </button>
          <div className="amount strong" style={{ flex: 1, fontSize: 24, textAlign: 'right', letterSpacing: '-0.02em', overflowWrap: 'anywhere' }}>
            {from === to ? f.money(amount, to) : rate ? f.money(converted, to) : '—'}
          </div>
        </div>
        <div className="divider" />
        <div className="hstack small">
          <div style={{ flex: 1 }}>
            <div className="strong">
              1 {from} = {formatRate(rate, f.locale)} {to}
            </div>
            <div className="muted xsmall">
              {snapshot.kind === 'demo' ? 'Demo rate · sample data' : `Indicative · ${f.dateTime(snapshot.publishedAt)}`}
            </div>
          </div>
          <button className="icon-btn" aria-label={isFav ? 'Remove pair from favorites' : 'Add pair to favorites'} onClick={toggleFav} disabled={from === to}>
            <Star size={20} fill={isFav ? 'currentColor' : 'none'} style={isFav ? { color: 'var(--warning)' } : undefined} />
          </button>
        </div>
        <div className="row" style={{ padding: '8px 0 0', minHeight: 44 }}>
          <div className="row-main">
            <div className="row-title small">Include simulated fee</div>
            <div className="row-sub xsmall">{withFee ? `Fee ${f.money(fee, from)} on top · total ${f.money(amount + fee, from)}` : `${(app.settings.fees.exchange.bps / 100).toFixed(2)}% charged in ${from}`}</div>
          </div>
          <Switch checked={withFee} onChange={setWithFee} label="Include simulated fee" />
        </div>
      </div>

      {app.fx.favorites.length > 0 && (
        <Section title="Favorite pairs">
          <div className="chips">
            {app.fx.favorites.map(([a, b]) => (
              <Chip
                key={a + b}
                pressed={a === from && b === to}
                onClick={() => {
                  setFrom(a);
                  setTo(b);
                }}
              >
                {a}/{b}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      <div style={{ marginTop: 18 }}>
        <Button
          block
          disabled={amount <= 0 || !rate || from === to}
          onClick={() => {
            const id = openSheet((close) => <ExchangeSheet from={from} to={to} amount={amount} snapshot={snapshot} close={close} />, { tall: true });
            void id;
          }}
        >
          Simulate conversion
        </Button>
      </div>

      {app.fx.lookups.length > 0 && (
        <Section
          title="Conversion history"
          action={
            <button className="link-btn" onClick={() => update((s) => ({ ...s, fx: { ...s.fx, lookups: [] } }))}>
              Clear
            </button>
          }
        >
          <div className="list">
            {app.fx.lookups.slice(0, 8).map((l) => (
              <button
                key={l.id}
                className="row"
                onClick={() => {
                  setFrom(l.from);
                  setTo(l.to);
                  setText(String(l.amount / 10 ** CURRENCIES[l.from].decimals));
                }}
              >
                <div className="row-main">
                  <div className="row-title amount">
                    {f.money(l.amount, l.from)} → {f.money(l.result, l.to)}
                  </div>
                  <div className="row-sub">
                    {f.dateTime(l.createdAt)} · {l.rateSource === 'demo' ? 'demo rate' : 'indicative'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {recentExchanges.length > 0 && (
        <Section title="Simulated conversions">
          <div className="list">
            {recentExchanges.map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        </Section>
      )}
      <p className="disclaimer">
        Indicative rates are for information only and differ from what real providers charge. Demo rates are fixed sample values bundled with the app. Conversions here are simulations recorded in your local ledger.
      </p>
    </Page>
  );
}

