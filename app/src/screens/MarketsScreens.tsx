import Big from 'big.js';
import { ChartCandlestick, ChartLine, CircleCheck, History, RefreshCw, Search, Star, TrendingUp, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ASSET_KIND_LABEL,
  ASSET_MAP,
  ASSETS,
  assetStats,
  candleHistory,
  change24h,
  demoPrice,
  demoQuote,
  executeTrade,
  formatQty,
  investmentAccount,
  portfolioHistory,
  portfolioSummary,
  priceHistory,
  quoteTrade,
  RANGE_IDS,
  type AssetDef,
  type AssetKind,
  type RangeId,
} from '../domain/markets';
import { parseAmount } from '../domain/money';
import { OP_ERROR_TEXT } from '../domain/types';
import { act, newOpKey } from '../state/actions';
import { update, useApp } from '../state/store';
import { nav, openSheet, toast } from '../state/ui';
import { CHART } from '../ui/tokens';
import { CandleChart, Donut, LineChart, Sparkline } from '../ui/components/charts';
import { useFmt } from '../ui/components/Money';
import { SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Chip, EmptyState, KV, Notice, Page, SearchInput, Section, Segmented, TextInput, useScreen } from '../ui/components/primitives';
import { openTransferSheet } from './TransferSheet';
import { useNow } from './common';
import { formatPrice } from './markets/format';

function AssetRow({ a, now }: { a: AssetDef; now: number }) {
  const f = useFmt();
  const ch = change24h(a, now);
  const spark = useMemo(() => priceHistory(a, '1D', Math.floor(now / 300_000) * 300_000).filter((_, i) => i % 6 === 0).map((p) => p.p), [a, Math.floor(now / 300_000)]);
  return (
    <button className="row" onClick={() => nav.push('asset', { symbol: a.symbol })}>
      <div className="row-main">
        <div className="row-title">
          {a.display} {!a.tradable && <span className="badge badge-muted" style={{ marginLeft: 4 }}>watch</span>}
        </div>
        <div className="row-sub">{a.name}</div>
      </div>
      <Sparkline values={spark} color={ch >= 0 ? 'var(--positive)' : 'var(--negative)'} />
      <div className="row-end" style={{ minWidth: 96 }}>
        <div className="row-title amount">{formatPrice(demoPrice(a, now), a, f.locale)}</div>
        <div className={`row-sub ${ch >= 0 ? 'pos' : 'neg'}`}>{f.pct(ch, 2)}</div>
      </div>
    </button>
  );
}

function DemoOff() {
  return (
    <EmptyState
      icon={<ChartCandlestick size={26} />}
      title="Market demo is off"
      action={
        <Button onClick={() => update((s) => ({ ...s, markets: { ...s.markets, demoEnabled: true } }))}>Turn on market demo</Button>
      }
    >
      Turn it on to explore simulated prices, a watchlist and a practice portfolio. Prices are demo data, never real quotes.
    </EmptyState>
  );
}

export function MarketsScreen() {
  const app = useApp();
  const f = useFmt();
  const now = useNow(3000);
  const [tab, setTab] = useState<'watchlist' | 'explore'>('watchlist');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [q, setQ] = useState('');
  const p = useMemo(() => portfolioSummary(app, now), [app, now]);
  const watch = app.markets.watchlist.map((s) => ASSET_MAP.get(s)).filter((a): a is AssetDef => !!a);
  const query = q.trim().toLowerCase();
  const explore = ASSETS.filter((a) => (kind === 'all' || a.kind === kind) && (!query || `${a.symbol} ${a.display} ${a.name}`.toLowerCase().includes(query)));
  return (
    <>
      <header className="topbar" style={{ paddingLeft: 16 }}>
        <h1 className="page-title" style={{ margin: 0, flex: 1 }}>
          Markets
        </h1>
        <Badge tone="sim">Demo prices</Badge>
        <button className="icon-btn" aria-label="Order history" onClick={() => nav.push('orders')}>
          <History size={20} />
        </button>
      </header>
      <div className="scroll">
        {!app.markets.demoEnabled ? (
          <DemoOff />
        ) : (
          <>
            <button className="hero" style={{ width: '100%', textAlign: 'left', color: 'var(--text)' }} onClick={() => nav.push('portfolio')}>
              <div className="hero-top">
                <span>Practice portfolio</span>
                <Badge tone="sim">Simulated</Badge>
              </div>
              <div className="hero-amount" style={{ fontSize: 34 }}>
                <span className="amount">{f.money(p.total, 'USD', { sensitive: true })}</span>
              </div>
              <div className="hero-sub">
                <span className={p.dayChange >= 0 ? 'pos' : 'neg'}>
                  {f.money(p.dayChange, 'USD', { sign: 'exceptZero', sensitive: true })} ({f.pct(p.dayChangePct, 2)}) today
                </span>
                <span>·</span>
                <span>
                  Unrealized <span className={p.unrealized >= 0 ? 'pos' : 'neg'}>{f.money(p.unrealized, 'USD', { sign: 'exceptZero', sensitive: true })}</span>
                </span>
              </div>
              <div className="hero-sub" style={{ marginTop: 6 }}>
                Cash {f.money(p.cash, 'USD', { sensitive: true })} · {p.positions.length} position{p.positions.length === 1 ? '' : 's'}
              </div>
            </button>
            <div style={{ marginTop: 16 }}>
              <Segmented
                value={tab}
                onChange={setTab}
                label="Market list"
                options={[
                  { value: 'watchlist', label: `Watchlist (${watch.length})` },
                  { value: 'explore', label: 'Explore' },
                ]}
              />
            </div>
            {tab === 'watchlist' ? (
              <div style={{ marginTop: 12 }}>
                {watch.length ? (
                  <div className="list">
                    {watch.map((a) => (
                      <AssetRow key={a.symbol} a={a} now={now} />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Star size={24} />} title="Your watchlist is empty" action={<Button size="sm" onClick={() => setTab('explore')}>Explore assets</Button>}>
                    Star assets to follow their demo prices here.
                  </EmptyState>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <SearchInput value={q} onChange={setQ} placeholder="Search symbol or name" icon={<Search size={18} />} />
                <div className="chips" style={{ margin: '10px 0' }}>
                  <Chip pressed={kind === 'all'} onClick={() => setKind('all')}>
                    All
                  </Chip>
                  {(Object.keys(ASSET_KIND_LABEL) as AssetKind[]).map((k) => (
                    <Chip key={k} pressed={kind === k} onClick={() => setKind(k)}>
                      {ASSET_KIND_LABEL[k]}
                    </Chip>
                  ))}
                </div>
                {explore.length ? (
                  <div className="list">
                    {explore.map((a) => (
                      <AssetRow key={a.symbol} a={a} now={now} />
                    ))}
                  </div>
                ) : (
                  <div className="panel pad muted small center">No assets match “{q}”.</div>
                )}
              </div>
            )}
            <p className="disclaimer">
              All prices are generated by VELTRIX’s deterministic demo engine for practice. They are not market data, not investment advice, and orders never reach a broker.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------- Trade ------------------------------- */

function TradeSheet({ symbol, initialSide, close }: { symbol: string; initialSide: 'buy' | 'sell'; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const asset = ASSET_MAP.get(symbol)!;
  const [side, setSide] = useState(initialSide);
  const [mode, setMode] = useState<'usd' | 'qty'>('usd');
  const [text, setText] = useState('');
  const [quoteAt, setQuoteAt] = useState(() => Date.now());
  const [stage, setStage] = useState<'edit' | 'review' | 'done'>('edit');
  const [opKey, setOpKey] = useState(() => newOpKey('trade'));
  const [filled, setFilled] = useState<{ qty: string; total: number; pnl?: number } | null>(null);
  const price = demoQuote(asset, quoteAt);
  const acc = investmentAccount(app);
  const pos = app.markets.positions[symbol];
  const usd = mode === 'usd' && text ? parseAmount(text, 2) : null;
  let qtyText: string | undefined;
  if (mode === 'qty' && text) {
    try {
      qtyText = new Big(text.replace(',', '.')).toString();
    } catch {
      qtyText = undefined;
    }
  }
  const req = { symbol, side, price, notional: usd?.ok ? usd.minor : undefined, quantity: mode === 'qty' ? qtyText : undefined };
  const q = text ? quoteTrade(app, req) : null;
  const error = q && 'error' in q ? OP_ERROR_TEXT[q.error] : null;
  const insufficient = q && !('error' in q) && side === 'buy' && acc && acc.balance < q.total;
  const valid = q && !('error' in q) && !insufficient;
  const confirmIt = () => {
    const r = act((s, ctx) => executeTrade(s, { ...req, opKey }, ctx));
    if (r.ok) {
      setFilled({ qty: r.order.quantity, total: r.order.total, pnl: r.order.realizedPnl });
      setStage('done');
    }
  };
  if (stage === 'done' && filled) {
    return (
      <>
        <SheetHeader title="Order filled" onClose={close} />
        <div className="sheet-body">
          <div className="result">
            <div className="result-ico ok">
              <CircleCheck size={40} />
            </div>
            <h2 style={{ margin: '0 0 6px' }}>Simulated order filled</h2>
            <div className="muted">
              {side === 'buy' ? 'Bought' : 'Sold'} {formatQty(filled.qty, asset)} {asset.unit === 'shares' || asset.unit === 'units' ? asset.display : asset.unit} at a demo price of {formatPrice(Number(price), asset, f.locale)}
            </div>
            <div className="strong" style={{ marginTop: 8 }}>
              {side === 'buy' ? 'Cash used' : 'Cash received'} {f.money(filled.total, 'USD')}
            </div>
            {filled.pnl !== undefined && <div className={filled.pnl >= 0 ? 'pos' : 'neg'}>Realized P&L {f.money(filled.pnl, 'USD', { sign: 'exceptZero' })}</div>}
          </div>
        </div>
        <div className="sheet-foot btn-row">
          <Button
            variant="secondary"
            onClick={() => {
              close();
              nav.push('portfolio');
            }}
          >
            Portfolio
          </Button>
          <Button onClick={close}>Done</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <SheetHeader title={`${side === 'buy' ? 'Buy' : 'Sell'} ${asset.display}`} onClose={close} />
      <div className="sheet-body">
        {stage === 'edit' ? (
          <>
            <Segmented value={side} onChange={(v) => setSide(v)} label="Order side" options={[{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }]} />
            <div className="panel pad" style={{ marginTop: 12 }}>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="xsmall faint">Demo quote (locked for this order)</div>
                  <div className="strong amount" style={{ fontSize: 20 }}>
                    {formatPrice(Number(price), asset, f.locale)}
                  </div>
                  <div className="xsmall faint">{f.time(new Date(quoteAt).toISOString())}</div>
                </div>
                <button className="icon-btn filled" aria-label="Refresh demo quote" onClick={() => setQuoteAt(Date.now())}>
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <Segmented
                value={mode}
                small
                onChange={(m) => {
                  setMode(m);
                  setText('');
                }}
                label="Order size type"
                options={[
                  { value: 'usd', label: 'Amount (USD)' },
                  { value: 'qty', label: `Quantity (${asset.unit})` },
                ]}
              />
            </div>
            <div style={{ marginTop: 10 }}>
              <TextInput value={text} onChange={(v) => setText(v.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder={mode === 'usd' ? 'e.g. 250' : `e.g. ${asset.qtyDp ? '0.5' : '10'}`} ariaLabel="Order size" autoFocus />
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {side === 'buy'
                ? [100, 500, 1000, 5000].map((v) => (
                    <Chip
                      key={v}
                      onClick={() => {
                        setMode('usd');
                        setText(String(v));
                      }}
                    >
                      ${v}
                    </Chip>
                  ))
                : pos
                  ? [0.25, 0.5, 1].map((fr) => (
                      <Chip
                        key={fr}
                        onClick={() => {
                          setMode('qty');
                          setText(new Big(pos.quantity).times(fr).round(asset.qtyDp, Big.roundDown).toString());
                        }}
                      >
                        {fr === 1 ? 'All' : `${fr * 100}%`}
                      </Chip>
                    ))
                  : null}
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              {side === 'buy' ? `Investment cash ${acc ? f.money(acc.balance, 'USD', { sensitive: true }) : '—'}` : `You hold ${pos ? formatQty(pos.quantity, asset) : '0'} ${asset.unit}`}
            </div>
            {(error || insufficient) && text && (
              <Notice tone="error" style={{ marginTop: 10 }}>
                {insufficient ? 'Not enough simulated cash in your investment account.' : error}
              </Notice>
            )}
            {insufficient && (
              <div style={{ marginTop: 10 }}>
                <Button variant="secondary" size="sm" icon={<Wallet size={16} />} onClick={() => acc && openTransferSheet({ toId: acc.id })}>
                  Move cash to Investment
                </Button>
              </div>
            )}
            {valid && q && !('error' in q) && (
              <div className="panel pad" style={{ marginTop: 12, paddingTop: 4, paddingBottom: 4 }}>
                <KV k="Quantity" v={`${formatQty(q.quantity, asset)} ${asset.unit}`} />
                <KV k="Order value" v={f.money(q.notional, 'USD')} />
                <KV k="Hypothetical fee" v={f.money(q.fee, 'USD')} />
                <KV k={side === 'buy' ? 'Total cost' : 'You receive'} v={<span className="strong">{f.money(q.total, 'USD')}</span>} />
              </div>
            )}
          </>
        ) : (
          q &&
          !('error' in q) && (
            <>
              <div className="sim-banner">Simulated order · nothing is sent to a broker</div>
              <div className="panel pad" style={{ marginTop: 12, paddingTop: 4, paddingBottom: 4 }}>
                <KV k="Order" v={`${side === 'buy' ? 'Buy' : 'Sell'} ${asset.display}`} />
                <KV k="Quantity" v={`${formatQty(q.quantity, asset)} ${asset.unit}`} />
                <KV k="Demo price" v={formatPrice(Number(q.price), asset, f.locale)} />
                <KV k="Order value" v={f.money(q.notional, 'USD')} />
                <KV k="Hypothetical fee" v={f.money(q.fee, 'USD')} />
                <KV k={side === 'buy' ? 'Total cost' : 'You receive'} v={<span className="strong">{f.money(q.total, 'USD')}</span>} />
                {side === 'buy' && q.avgCostAfter && <KV k="New average cost" v={`$${new Big(q.avgCostAfter).toFixed(asset.priceDp)}`} />}
                {side === 'sell' && q.realizedPnl !== undefined && <KV k="Estimated realized P&L" v={<span className={q.realizedPnl >= 0 ? 'pos' : 'neg'}>{f.money(q.realizedPnl, 'USD', { sign: 'exceptZero' })}</span>} />}
              </div>
              <p className="disclaimer">Filled instantly at the locked demo price. Hypothetical fees are configurable in Settings → Fees.</p>
            </>
          )
        )}
      </div>
      <div className="sheet-foot">
        {stage === 'edit' ? (
          <Button
            block
            disabled={!valid}
            onClick={() => {
              setOpKey(newOpKey('trade'));
              setStage('review');
            }}
          >
            Review order
          </Button>
        ) : (
          <div className="btn-row">
            <Button variant="secondary" onClick={() => setStage('edit')}>
              Edit
            </Button>
            <Button onClick={confirmIt}>Confirm {side}</Button>
          </div>
        )}
      </div>
    </>
  );
}

export function openTradeSheet(symbol: string, side: 'buy' | 'sell'): void {
  openSheet((close) => <TradeSheet symbol={symbol} initialSide={side} close={close} />);
}

/* ------------------------------- Asset ------------------------------- */

export function AssetScreen() {
  const { route } = useScreen();
  const app = useApp();
  const f = useFmt();
  const now = useNow(3000);
  const asset = ASSET_MAP.get(route.params.symbol ?? '');
  const [range, setRange] = useState<RangeId>('1D');
  const [type, setType] = useState<'line' | 'candle'>('line');
  const bucket = Math.floor(now / 60_000);
  const hist = useMemo(() => (asset ? priceHistory(asset, range, now) : []), [asset, range, range === '1D' ? Math.floor(now / 15_000) : bucket]);
  const candles = useMemo(() => (asset && type === 'candle' ? candleHistory(asset, range, now, 48) : []), [asset, range, type, bucket]);
  const stats = useMemo(() => (asset ? assetStats(asset, now) : null), [asset, bucket]);
  if (!asset || !stats) {
    return (
      <Page title="Asset">
        <EmptyState icon={<ChartLine size={24} />} title="Unknown asset" />
      </Page>
    );
  }
  const price = demoPrice(asset, now);
  const first = hist[0]?.p ?? price;
  const rangeChange = ((price - first) / first) * 100;
  const watching = app.markets.watchlist.includes(asset.symbol);
  const pos = app.markets.positions[asset.symbol];
  const value = pos ? Number(new Big(pos.quantity).times(price).times(100).round(0).toString()) : 0;
  const basis = pos ? Number(new Big(pos.quantity).times(pos.avgCost).times(100).round(0).toString()) : 0;
  const realized = app.markets.orders.filter((o) => o.symbol === asset.symbol && o.realizedPnl !== undefined).reduce((s, o) => s + (o.realizedPnl ?? 0), 0);
  const fmtP = (v: number) => formatPrice(v, asset, f.locale);
  const timeFmt = (t: number) => (range === '1D' || range === '1W' ? `${f.short(new Date(t))} ${f.time(new Date(t).toISOString())}` : f.short(new Date(t)));
  return (
    <Page
      title={asset.display}
      right={
        <button
          className="icon-btn"
          aria-label={watching ? 'Remove from watchlist' : 'Add to watchlist'}
          onClick={() => {
            update((s) => ({ ...s, markets: { ...s.markets, watchlist: watching ? s.markets.watchlist.filter((x) => x !== asset.symbol) : [...s.markets.watchlist, asset.symbol] } }));
            toast(watching ? 'Removed from watchlist' : 'Added to watchlist', 'success');
          }}
        >
          <Star size={21} fill={watching ? 'currentColor' : 'none'} style={watching ? { color: 'var(--warning)' } : undefined} />
        </button>
      }
    >
      <div style={{ margin: '4px 4px 10px' }}>
        <div className="muted small">
          {asset.name} · {ASSET_KIND_LABEL[asset.kind]}
        </div>
        <div className="amount" style={{ fontSize: 34, fontWeight: 720, letterSpacing: '-0.03em', margin: '2px 0' }}>
          {fmtP(price)}
        </div>
        <div className="hstack small" style={{ gap: 8 }}>
          <span className={rangeChange >= 0 ? 'pos strong' : 'neg strong'}>
            {f.pct(rangeChange, 2)} {range}
          </span>
          <Badge tone="sim">Demo price</Badge>
        </div>
      </div>
      <div style={{ marginTop: 34 }}>
        {type === 'line' ? (
          <LineChart data={hist.map((p) => ({ t: p.t, v: p.p }))} height={210} color={rangeChange >= 0 ? 'var(--positive)' : 'var(--negative)'} formatValue={fmtP} formatTime={timeFmt} label={`${asset.display} demo price, ${range}`} />
        ) : (
          <CandleChart data={candles} height={210} formatValue={fmtP} formatTime={timeFmt} label={`${asset.display} demo candles, ${range}`} />
        )}
      </div>
      <div className="hstack" style={{ marginTop: 14, gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Segmented value={range} onChange={setRange} small label="Chart range" options={RANGE_IDS.map((r) => ({ value: r, label: r }))} />
        </div>
        <Segmented
          value={type}
          onChange={setType}
          small
          label="Chart type"
          options={[
            { value: 'line', label: <ChartLine size={16} aria-label="Line" /> },
            { value: 'candle', label: <ChartCandlestick size={16} aria-label="Candles" /> },
          ]}
        />
      </div>
      <Section title="Stats">
        <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <KV k="24h change" v={<span className={stats.change >= 0 ? 'pos' : 'neg'}>{f.pct(stats.change, 2)}</span>} />
          <KV k="Day range" v={`${fmtP(stats.dayLow)} – ${fmtP(stats.dayHigh)}`} />
          <KV k="52-week range" v={`${fmtP(stats.yearLow)} – ${fmtP(stats.yearHigh)}`} />
          <KV k="Trading in simulator" v={asset.tradable ? 'Yes · settles in USD' : 'Watch-only'} />
        </div>
      </Section>
      {pos && (
        <Section title="Your simulated position">
          <div className="panel pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <KV k="Quantity" v={`${formatQty(pos.quantity, asset)} ${asset.unit}`} />
            <KV k="Average entry (incl. fees)" v={`$${new Big(pos.avgCost).toFixed(asset.priceDp)}`} />
            <KV k="Market value (demo)" v={f.money(value, 'USD', { sensitive: true })} />
            <KV k="Unrealized P&L" v={<span className={value - basis >= 0 ? 'pos' : 'neg'}>{f.money(value - basis, 'USD', { sign: 'exceptZero', sensitive: true })} ({f.pct(basis ? ((value - basis) / basis) * 100 : 0, 2)})</span>} />
            {realized !== 0 && <KV k="Realized P&L" v={<span className={realized >= 0 ? 'pos' : 'neg'}>{f.money(realized, 'USD', { sign: 'exceptZero' })}</span>} />}
          </div>
        </Section>
      )}
      {!app.markets.demoEnabled ? (
        <Notice style={{ marginTop: 16 }}>Market demo is turned off in Settings.</Notice>
      ) : asset.tradable ? (
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Button variant="secondary" onClick={() => openTradeSheet(asset.symbol, 'sell')} disabled={!pos}>
            Sell
          </Button>
          <Button onClick={() => openTradeSheet(asset.symbol, 'buy')}>Buy</Button>
        </div>
      ) : (
        <Notice style={{ marginTop: 16 }}>This pair isn’t quoted in USD, so it’s watch-only in the simulator. Use the converter to simulate currency exchanges.</Notice>
      )}
      <p className="disclaimer">Demo prices are simulated for practice and are not real market data. No orders reach any broker or exchange.</p>
    </Page>
  );
}

/* ----------------------------- Portfolio ----------------------------- */

export function PortfolioScreen() {
  const app = useApp();
  const f = useFmt();
  const now = useNow(5000);
  const [range, setRange] = useState<RangeId>('1M');
  const p = useMemo(() => portfolioSummary(app, now), [app, now]);
  const hist = useMemo(() => portfolioHistory(app, range, now), [app, range, Math.floor(now / 60_000)]);
  const acc = investmentAccount(app);
  const byKind = useMemo(() => {
    const m = new Map<AssetKind, number>();
    for (const x of p.positions) m.set(x.asset.kind, (m.get(x.asset.kind) ?? 0) + x.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [p.positions]);
  const first = hist[0]?.p ?? p.total;
  return (
    <Page title="Portfolio">
      <div style={{ margin: '4px 4px 10px' }}>
        <div className="muted small">Total value (demo prices)</div>
        <div className="amount" style={{ fontSize: 34, fontWeight: 720, letterSpacing: '-0.03em' }}>
          {f.money(p.total, 'USD', { sensitive: true })}
        </div>
        <div className={`small strong ${p.total - first >= 0 ? 'pos' : 'neg'}`}>
          {f.money(p.total - first, 'USD', { sign: 'exceptZero', sensitive: true })} · {range}
        </div>
      </div>
      {!app.settings.hideBalances && hist.length > 1 && (
        <div style={{ marginTop: 30 }}>
          <LineChart data={hist.map((x) => ({ t: x.t, v: x.p }))} height={170} color={p.total - first >= 0 ? 'var(--positive)' : 'var(--negative)'} formatValue={(v) => f.money(Math.round(v), 'USD')} formatTime={(t) => f.short(new Date(t))} label="Portfolio value history" />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Segmented value={range} onChange={setRange} small label="Range" options={RANGE_IDS.map((r) => ({ value: r, label: r }))} />
      </div>
      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="panel stat">
          <div className="label">Cash</div>
          <div className="value amount">{f.money(p.cash, 'USD', { sensitive: true })}</div>
        </div>
        <div className="panel stat">
          <div className="label">Holdings</div>
          <div className="value amount">{f.money(p.holdings, 'USD', { sensitive: true })}</div>
        </div>
        <div className="panel stat">
          <div className="label">Unrealized P&L</div>
          <div className={`value amount ${p.unrealized >= 0 ? 'pos' : 'neg'}`}>{f.money(p.unrealized, 'USD', { sign: 'exceptZero', sensitive: true })}</div>
        </div>
        <div className="panel stat">
          <div className="label">Realized P&L</div>
          <div className={`value amount ${p.realized >= 0 ? 'pos' : 'neg'}`}>{f.money(p.realized, 'USD', { sign: 'exceptZero', sensitive: true })}</div>
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <Button variant="secondary" size="sm" icon={<Wallet size={16} />} onClick={() => acc && openTransferSheet({ toId: acc.id })} disabled={!acc}>
          Add cash
        </Button>
        <Button variant="secondary" size="sm" icon={<History size={16} />} onClick={() => nav.push('orders')}>
          Orders
        </Button>
      </div>
      {byKind.length > 0 && (
        <Section title="Allocation">
          <div className="panel pad hstack" style={{ gap: 18 }}>
            <Donut slices={byKind.map(([k, v], i) => ({ value: v, color: CHART[i % CHART.length], label: ASSET_KIND_LABEL[k] }))} size={116} thickness={15} label="Allocation by asset class">
              <span className="xsmall faint">{p.positions.length} assets</span>
            </Donut>
            <div className="stack" style={{ flex: 1, gap: 8 }}>
              {byKind.map(([k, v], i) => (
                <div key={k} className="hstack small" style={{ gap: 8 }}>
                  <span className="legend-dot" style={{ background: CHART[i % CHART.length] }} />
                  <span style={{ flex: 1 }}>{ASSET_KIND_LABEL[k]}</span>
                  <span className="faint">{p.holdings ? Math.round((v / p.holdings) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
      <Section title="Positions">
        {p.positions.length ? (
          <div className="list">
            {p.positions.map((x) => (
              <button key={x.symbol} className="row" onClick={() => nav.push('asset', { symbol: x.symbol })}>
                <div className="row-main">
                  <div className="row-title">{x.asset.display}</div>
                  <div className="row-sub">
                    {formatQty(x.quantity, x.asset)} {x.asset.unit} · avg ${new Big(x.avgCost).toFixed(x.asset.priceDp)}
                  </div>
                </div>
                <div className="row-end">
                  <div className="row-title amount">{f.money(x.value, 'USD', { sensitive: true })}</div>
                  <div className={`row-sub ${x.unrealized >= 0 ? 'pos' : 'neg'}`}>
                    {f.money(x.unrealized, 'USD', { sign: 'exceptZero', sensitive: true })} ({f.pct(x.unrealizedPct, 1)})
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<TrendingUp size={24} />} title="No positions yet" action={<Button size="sm" onClick={() => nav.tab('markets')}>Explore markets</Button>}>
            Buy a demo asset to start your practice portfolio.
          </EmptyState>
        )}
      </Section>
      <p className="disclaimer">Average entry includes hypothetical buy fees. Unrealized P&L uses current demo prices; realized P&L is booked on simulated sells.</p>
    </Page>
  );
}

export function OrdersScreen() {
  const app = useApp();
  const f = useFmt();
  return (
    <Page title="Order history">
      {app.markets.orders.length ? (
        <div className="list" style={{ marginTop: 6 }}>
          {app.markets.orders.map((o) => {
            const a = ASSET_MAP.get(o.symbol);
            return (
              <button key={o.id} className="row" onClick={() => nav.push('txn', { id: o.txnId })}>
                <Badge tone={o.side === 'buy' ? 'info' : 'accent'}>{o.side}</Badge>
                <div className="row-main">
                  <div className="row-title">{a?.display ?? o.symbol}</div>
                  <div className="row-sub">
                    {a ? formatQty(o.quantity, a) : o.quantity} @ {a ? formatPrice(Number(o.price), a, f.locale) : o.price} · {f.day(o.createdAt)}
                  </div>
                </div>
                <div className="row-end">
                  <div className="row-title amount">{f.money(o.side === 'buy' ? -o.total : o.total, 'USD', { sign: 'exceptZero' })}</div>
                  {o.realizedPnl !== undefined && <div className={`row-sub ${o.realizedPnl >= 0 ? 'pos' : 'neg'}`}>P&L {f.money(o.realizedPnl, 'USD', { sign: 'exceptZero' })}</div>}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<History size={24} />} title="No simulated orders yet">
          Orders you place in the market simulator appear here.
        </EmptyState>
      )}
    </Page>
  );
}
