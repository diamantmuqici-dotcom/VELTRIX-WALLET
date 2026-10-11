import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  HandCoins,
  History,
  Minus,
  Pencil,
  Plus,
  QrCode,
  Search,
  Settings,
  Star,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { balanceSeries, monthToDate } from '../domain/analytics';
import { CURRENCIES, PRIMARY_CURRENCIES, type CurrencyCode } from '../domain/currency';
import { addDays, dayKey, monthKeyOf, startOfDay, parseDayKey } from '../domain/dates';
import { convertForDisplay, crossRate, formatRate } from '../domain/fx';
import { CATEGORY_LABEL } from '../domain/labels';
import { cardSpend, effectOn } from '../domain/ledger';
import { ASSET_MAP, change24h, demoPrice, priceHistory } from '../domain/markets';
import { percentChange } from '../domain/money';
import { MAIN_ACCOUNT_ID } from '../domain/ops/common';
import { creditFigures } from '../domain/ops/entities';
import { nextOccurrence } from '../domain/ops/planning';
import { sortedCards } from '../domain/ops/entities';
import type { AppState, DashboardSectionId } from '../domain/types';
import { useRates } from '../state/rates';
import { update, useApp } from '../state/store';
import { nav } from '../state/ui';
import { CATEGORY_COLOR } from '../ui/tokens';
import { Wordmark } from '../ui/components/Brand';
import { Donut, LineChart, Sparkline } from '../ui/components/charts';
import { DemoCard } from '../ui/components/DemoCard';
import { AccountGlyph, Avatar, CurrencyBadge } from '../ui/components/Glyphs';
import { HeroAmount, useFmt } from '../ui/components/Money';
import { pickCurrency } from '../ui/components/pickers';
import { Badge, EmptyState, IconButton, ProgressBar, Section, SimBadge, tap } from '../ui/components/primitives';
import { greetingFor, openAdjustSheet, TxnRow, useNow } from './common';
import { formatPrice } from './markets/format';

/** Shrinks the hero balance for very long numbers so it never overflows. */
function heroSize(text: string): number {
  const len = text.length;
  return len <= 11 ? 44 : Math.max(22, Math.floor((44 * 11) / len));
}

function BalanceHero() {
  const app = useApp();
  const f = useFmt();
  const main = app.accounts.find((a) => a.id === MAIN_ACCOUNT_ID) ?? app.accounts[0];
  const [displayCur, setDisplayCur] = useState<CurrencyCode>(main.currency);
  const { snapshot } = useRates(app.settings.liveRates, app.fx.liveCache);
  const converted = displayCur === main.currency ? main.balance : convertForDisplay(main.balance, main.currency, displayCur, snapshot, CURRENCIES[main.currency].decimals, CURRENCIES[displayCur].decimals);
  const today = useMemo(() => {
    const from = startOfDay(new Date()).getTime();
    let d = 0;
    for (const t of app.transactions) if (new Date(t.createdAt).getTime() >= from) d += effectOn(t, main.id);
    return d;
  }, [app.transactions, main.id]);
  const hidden = app.settings.hideBalances;
  return (
    <section className="hero" aria-label="Main wallet balance">
      <div className="hero-top">
        <span>{main.name}</span>
        <SimBadge />
        <span className="spacer" />
        <button
          className="mini-chip"
          aria-label={`Display currency ${displayCur}`}
          onClick={async () => {
            const c = await pickCurrency(displayCur, 'Show balance in', PRIMARY_CURRENCIES.includes(main.currency) ? PRIMARY_CURRENCIES : [main.currency, ...PRIMARY_CURRENCIES]);
            if (c) setDisplayCur(c);
          }}
        >
          {displayCur} <ChevronDown size={14} />
        </button>
        <button
          className="icon-btn"
          style={{ width: 34, height: 34 }}
          aria-label={hidden ? 'Show balances' : 'Hide balances'}
          onClick={() => {
            tap('select');
            update((s) => ({ ...s, settings: { ...s.settings, hideBalances: !s.settings.hideBalances } }));
          }}
        >
          {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <button className="hero-amount" style={{ fontSize: heroSize(converted === null ? '' : f.money(converted, displayCur)) }} onClick={() => openAdjustSheet('set')} aria-label="Edit simulated balance">
        {converted === null ? <span className="amount">—</span> : <HeroAmount minor={converted} currency={displayCur} hidden={hidden} />}
      </button>
      <div className="hero-sub">
        {displayCur !== main.currency ? (
          <span>
            ≈ converted from {main.currency} at {snapshot.kind === 'demo' ? 'demo' : 'indicative'} rates
          </span>
        ) : (
          <span className={today > 0 ? 'pos' : undefined}>
            {today === 0 ? 'No change today' : `${f.money(today, main.currency, { sign: 'exceptZero', sensitive: true })} today`}
          </span>
        )}
        {!app.settings.trackBalances && <Badge tone="sim">Tracking off</Badge>}
      </div>
      <div className="hero-actions">
        <button className="hero-act" onClick={() => openAdjustSheet('add')}>
          <Plus size={16} /> Add
        </button>
        <button className="hero-act" onClick={() => openAdjustSheet('remove')}>
          <Minus size={16} /> Remove
        </button>
        <button className="hero-act" onClick={() => openAdjustSheet('set')}>
          <Pencil size={15} /> Edit
        </button>
        <button className="hero-act" onClick={() => nav.push('account', { id: main.id })}>
          <History size={16} /> History
        </button>
      </div>
    </section>
  );
}

const QUICK: Array<{ label: string; icon: ReactNode; run: () => void; primary?: boolean }> = [
  { label: 'Send', icon: <ArrowUpRight size={22} />, run: () => nav.push('send'), primary: true },
  { label: 'Request', icon: <HandCoins size={22} />, run: () => nav.push('request') },
  { label: 'Receive', icon: <QrCode size={22} />, run: () => nav.push('receive') },
  { label: 'Add Funds', icon: <Plus size={22} />, run: () => openAdjustSheet('add') },
  { label: 'Cards', icon: <CreditCard size={22} />, run: () => nav.push('cards') },
  { label: 'Exchange', icon: <ArrowLeftRight size={22} />, run: () => nav.push('exchange') },
  { label: 'Invest', icon: <TrendingUp size={22} />, run: () => nav.tab('markets') },
  { label: 'Activity', icon: <Activity size={22} />, run: () => nav.tab('activity') },
];

function QuickActions() {
  return (
    <div className="qa-grid">
      {QUICK.map((q) => (
        <button
          key={q.label}
          className={`qa${q.primary ? ' primary' : ''}`}
          onClick={() => {
            tap();
            q.run();
          }}
        >
          <span className="qa-ico">{q.icon}</span>
          {q.label}
        </button>
      ))}
    </div>
  );
}

function AccountsSection() {
  const app = useApp();
  const f = useFmt();
  const list = app.accounts.filter((a) => !a.archived && a.showOnDashboard).sort((a, b) => a.order - b.order);
  return (
    <Section title="Accounts" action={<button className="link-btn" onClick={() => nav.push('accounts')}>Manage</button>}>
      <div className="hscroll">
        {list.map((a) => {
          const cf = a.kind === 'credit' ? creditFigures(a) : null;
          return (
            <button key={a.id} className="acct-tile" onClick={() => nav.push('account', { id: a.id })}>
              <AccountGlyph icon={a.icon} color={a.color} size={36} />
              <div>
                <div className="name">{a.name}</div>
                <div className="bal amount">{f.money(cf ? cf.available : a.balance, a.currency, { sensitive: true })}</div>
                <div className="xsmall faint">{cf ? 'available credit' : a.currency}</div>
              </div>
            </button>
          );
        })}
        <button className="acct-tile" onClick={() => nav.push('accountEdit')} style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--text-2)' }}>
          <Plus size={22} />
          <span className="small strong">New account</span>
        </button>
      </div>
    </Section>
  );
}

function CardPreviewSection() {
  const app = useApp();
  const cards = sortedCards(app);
  const card = cards.find((c) => c.id === app.settings.defaultCardId) ?? cards[0];
  return (
    <Section title="Card" action={<button className="link-btn" onClick={() => nav.push('cards')}>Card studio</button>}>
      {card ? (
        <button className="card-slide" style={{ width: '100%' }} onClick={() => nav.push('cardDetail', { id: card.id })} aria-label={`Open ${card.nickname}`}>
          <DemoCard card={card} />
        </button>
      ) : (
        <div className="panel">
          <EmptyState icon={<CreditCard size={24} />} title="No demo cards yet" action={<button className="btn btn-primary btn-sm" onClick={() => nav.push('cardEdit')}>Design a card</button>}>
            Create a fictional card in the card studio.
          </EmptyState>
        </div>
      )}
    </Section>
  );
}

function RecentSection() {
  const app = useApp();
  const recent = useMemo(() => [...app.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [app.transactions]);
  return (
    <Section title="Recent activity" action={<button className="link-btn" onClick={() => nav.tab('activity')}>See all</button>}>
      {recent.length ? (
        <div className="list">
          {recent.map((t) => (
            <TxnRow key={t.id} t={t} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState icon={<Activity size={24} />} title="No activity yet" action={<button className="btn btn-primary btn-sm" onClick={() => nav.push('send')}>Simulate a payment</button>}>
            Simulated payments, card purchases and transfers will appear here.
          </EmptyState>
        </div>
      )}
    </Section>
  );
}

function CashflowSection() {
  const app = useApp();
  const f = useFmt();
  const cur = app.settings.defaultCurrency;
  const m = useMemo(() => monthToDate(app, cur, new Date()), [app, cur]);
  const delta = (a: number, b: number, goodWhenUp: boolean) => {
    const p = percentChange(a, b);
    if (p === null) return <span className="faint">new this month</span>;
    if (Math.round(p) === 0) return <span className="faint">same as last month</span>;
    const good = goodWhenUp ? p > 0 : p < 0;
    return <span className={good ? 'pos' : 'neg'}>{Math.abs(p) >= 1000 ? `${p > 0 ? '>+' : '<−'}999%` : f.pct(p, 0)} vs last month</span>;
  };
  return (
    <Section title="This month" action={<button className="link-btn" onClick={() => nav.push('analytics')}>Analytics</button>}>
      <div className="stat-grid">
        <div className="panel stat">
          <div className="label">
            <ArrowDownLeft size={14} className="pos" /> Income
          </div>
          <div className="value amount">{f.money(m.current.income, cur, { sensitive: true })}</div>
          <div className="delta">{delta(m.current.income, m.previous.income, true)}</div>
        </div>
        <div className="panel stat">
          <div className="label">
            <ArrowUpRight size={14} /> Spending
          </div>
          <div className="value amount">{f.money(m.current.spending, cur, { sensitive: true })}</div>
          <div className="delta">{delta(m.current.spending, m.previous.spending, false)}</div>
        </div>
      </div>
      <p className="disclaimer">Simulated activity in {cur}. Transfers between your own accounts are not counted.</p>
    </Section>
  );
}

function CategoriesSection() {
  const app = useApp();
  const f = useFmt();
  const cur = app.settings.defaultCurrency;
  const m = useMemo(() => monthToDate(app, cur, new Date()), [app, cur]);
  const cats = m.current.byCategory.slice(0, 5);
  return (
    <Section title="Spending by category">
      <div className="panel pad">
        {cats.length === 0 ? (
          <div className="muted small center">No simulated spending in {cur} this month yet.</div>
        ) : (
          <div className="hstack" style={{ gap: 18, alignItems: 'center' }}>
            <Donut slices={cats.map((c) => ({ value: c.amount, color: CATEGORY_COLOR[c.key], label: CATEGORY_LABEL[c.key] }))} size={124} thickness={16} label="Spending by category this month">
              <div>
                <div className="xsmall faint">Spent</div>
                <div className="strong small amount">{f.money(m.current.spending, cur, { compact: true, sensitive: true })}</div>
              </div>
            </Donut>
            <div style={{ flex: 1, minWidth: 0 }} className="stack">
              {cats.map((c) => (
                <div key={c.key} className="hstack small" style={{ gap: 8 }}>
                  <span className="legend-dot" style={{ background: CATEGORY_COLOR[c.key] }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{CATEGORY_LABEL[c.key]}</span>
                  <span className="faint">{Math.round(c.share * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function TrendSection() {
  const app = useApp();
  const f = useFmt();
  const cur = app.settings.defaultCurrency;
  const series = useMemo(() => balanceSeries(app, cur, 30, new Date()), [app, cur]);
  const data = series.map((p) => ({ t: parseDayKey(p.day).getTime(), v: p.value }));
  const first = data[0]?.v ?? 0;
  const last = data[data.length - 1]?.v ?? 0;
  return (
    <Section title="30-day balance trend">
      <div className="panel pad">
        <div className="hstack" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div className="xsmall faint">All {cur} accounts</div>
            <div className="strong amount">{f.money(last, cur, { sensitive: true })}</div>
          </div>
          <div className={`small strong ${last >= first ? 'pos' : 'neg'}`}>{f.money(last - first, cur, { sign: 'exceptZero', sensitive: true })}</div>
        </div>
        {app.settings.hideBalances ? (
          <div className="muted small center" style={{ padding: 24 }}>
            Balances are hidden.
          </div>
        ) : (
          <LineChart data={data} height={120} formatValue={(v) => f.money(Math.round(v), cur)} formatTime={(t) => f.short(new Date(t))} label={`Balance trend over 30 days in ${cur}`} color={last >= first ? 'var(--positive)' : 'var(--negative)'} />
        )}
      </div>
    </Section>
  );
}

function UpcomingSection() {
  const app = useApp();
  const f = useFmt();
  const horizon = dayKey(addDays(new Date(), 21));
  const items = useMemo(() => {
    const out: Array<{ key: string; title: string; date: string; amount: number; currency: CurrencyCode; go: () => void }> = [];
    for (const b of app.bills) if (b.dueDate <= horizon) out.push({ key: b.id, title: b.name, date: b.dueDate, amount: b.amount, currency: b.currency, go: () => nav.push('bills') });
    for (const r of app.recurring) {
      if (!r.active) continue;
      let d: string | null = r.nextDate;
      let n = 0;
      while (d && d <= horizon && n < 3) {
        out.push({ key: `${r.id}${d}`, title: r.title, date: d, amount: r.amount, currency: r.currency, go: () => nav.push('recurring') });
        d = nextOccurrence(d, r.frequency);
        n++;
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  }, [app.bills, app.recurring, horizon]);
  return (
    <Section title="Upcoming" action={<button className="link-btn" onClick={() => nav.push('recurring')}>Schedules</button>}>
      {items.length ? (
        <div className="list">
          {items.map((i) => (
            <button key={i.key} className="row" onClick={i.go}>
              <div className="tile-ico">
                <div style={{ textAlign: 'center', lineHeight: 1 }}>
                  <div className="strong" style={{ fontSize: 15 }}>{parseDayKey(i.date).getDate()}</div>
                  <div className="xsmall faint" style={{ fontSize: 9.5, textTransform: 'uppercase' }}>{f.short(parseDayKey(i.date)).replace(/\s?\d+/, '')}</div>
                </div>
              </div>
              <div className="row-main">
                <div className="row-title">{i.title}</div>
                <div className="row-sub">{f.day(parseDayKey(i.date).toISOString())}</div>
              </div>
              <div className="row-end">
                <div className="row-title amount">{f.money(-i.amount, i.currency)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel pad muted small center">No bills or scheduled simulations in the next 3 weeks.</div>
      )}
    </Section>
  );
}

function GoalsSection() {
  const app = useApp();
  const f = useFmt();
  return (
    <Section title="Savings goals" action={<button className="link-btn" onClick={() => nav.push('goals')}>{app.goals.length ? 'All goals' : 'Create'}</button>}>
      {app.goals.length ? (
        <div className="list">
          {app.goals.slice(0, 3).map((g) => (
            <button key={g.id} className="row" onClick={() => nav.push('goals')}>
              <AccountGlyph icon={g.icon} color={g.color} />
              <div className="row-main">
                <div className="hstack" style={{ justifyContent: 'space-between' }}>
                  <span className="row-title">{g.name}</span>
                  <span className="small muted amount">
                    {f.money(g.saved, g.currency, { sensitive: true, compact: true })} / {f.money(g.target, g.currency, { compact: true })}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <ProgressBar value={g.saved} max={g.target} />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel pad muted small center">Set a fictional savings goal and move simulated money toward it.</div>
      )}
    </Section>
  );
}

function ContactsSection() {
  const app = useApp();
  const favs = app.contacts.filter((c) => c.favorite).slice(0, 8);
  const list = favs.length ? favs : app.contacts.slice(0, 8);
  return (
    <Section title="Favorite contacts" action={<button className="link-btn" onClick={() => nav.push('contacts')}>All</button>}>
      <div className="hscroll" style={{ gap: 16 }}>
        <button className="qa" style={{ flex: '0 0 64px' }} onClick={() => nav.push('contactEdit')}>
          <span className="qa-ico" style={{ borderRadius: '50%', borderStyle: 'dashed' }}>
            <UserPlus size={20} />
          </span>
          New
        </button>
        {list.map((c) => (
          <button key={c.id} className="qa" style={{ flex: '0 0 64px' }} onClick={() => nav.push('send', { contactId: c.id })} aria-label={`Send to ${c.name}`}>
            <Avatar name={c.name} color={c.color} size={56} />
            <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name.split(' ')[0]}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function CurrenciesSection() {
  const app = useApp();
  const { snapshot } = useRates(app.settings.liveRates, app.fx.liveCache);
  return (
    <Section title="Favorite currencies" action={<button className="link-btn" onClick={() => nav.push('exchange')}>Converter</button>}>
      {app.fx.favorites.length ? (
        <div className="list">
          {app.fx.favorites.slice(0, 4).map(([a, b]) => (
            <button key={`${a}${b}`} className="row" onClick={() => nav.push('exchange', { from: a, to: b })}>
              <CurrencyBadge code={a} />
              <div className="row-main">
                <div className="row-title">
                  {a} → {b}
                </div>
                <div className="row-sub">1 {a} =</div>
              </div>
              <div className="row-end">
                <div className="row-title amount">
                  {formatRate(crossRate(snapshot, a, b), app.settings.numberLocale)} {b}
                </div>
                <div className="row-sub">{snapshot.kind === 'demo' ? 'demo rate' : 'indicative'}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel pad muted small center">
          Star a currency pair in the converter to see it here. <Star size={14} />
        </div>
      )}
    </Section>
  );
}

function CardActivitySection() {
  const app = useApp();
  const f = useFmt();
  const month = monthKeyOf(new Date());
  const cards = sortedCards(app);
  return (
    <Section title="Card activity this month">
      {cards.length ? (
        <div className="list">
          {cards.map((c) => {
            const acc = app.accounts.find((a) => a.id === c.accountId);
            const spent = c.spendOverride ?? cardSpend(app, c.id, month);
            return (
              <button key={c.id} className="row" onClick={() => nav.push('cardDetail', { id: c.id })}>
                <CreditCard size={20} className="faint" />
                <div className="row-main">
                  <div className="hstack" style={{ justifyContent: 'space-between' }}>
                    <span className="row-title">
                      {c.nickname} <span className="faint small">•••• {c.displayDigits}</span>
                    </span>
                    <span className="small amount">{acc ? f.money(spent, acc.currency) : '—'}</span>
                  </div>
                  {c.spendLimit > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar value={spent} max={c.spendLimit} tone="auto" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="panel pad muted small center">No demo cards yet.</div>
      )}
    </Section>
  );
}

function WatchlistSection() {
  const app = useApp();
  const f = useFmt();
  const now = useNow(3000);
  const syms = app.markets.watchlist.filter((s) => ASSET_MAP.has(s)).slice(0, 4);
  if (!app.markets.demoEnabled) {
    return (
      <Section title="Watchlist">
        <div className="panel pad muted small center">Market demo data is off. Turn it on in Markets.</div>
      </Section>
    );
  }
  return (
    <Section title="Watchlist" action={<button className="link-btn" onClick={() => nav.tab('markets')}>Markets</button>}>
      <div className="list">
        {syms.map((s) => {
          const a = ASSET_MAP.get(s)!;
          const ch = change24h(a, now);
          return (
            <button key={s} className="row" onClick={() => nav.push('asset', { symbol: s })}>
              <div className="row-main">
                <div className="row-title">{a.display}</div>
                <div className="row-sub">{a.name}</div>
              </div>
              <Sparkline values={priceHistory(a, '1D', now).filter((_, i) => i % 6 === 0).map((p) => p.p)} color={ch >= 0 ? 'var(--positive)' : 'var(--negative)'} />
              <div className="row-end" style={{ minWidth: 92 }}>
                <div className="row-title amount">{formatPrice(demoPrice(a, now), a, f.locale)}</div>
                <div className={`row-sub ${ch >= 0 ? 'pos' : 'neg'}`}>{f.pct(ch, 2)}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="disclaimer">Demo prices from VELTRIX’s simulated market engine — not real market data.</p>
    </Section>
  );
}

const SECTION_COMPONENT: Record<DashboardSectionId, () => ReactNode> = {
  quickActions: () => <QuickActions />,
  accounts: () => <AccountsSection />,
  cardPreview: () => <CardPreviewSection />,
  recent: () => <RecentSection />,
  cashflow: () => <CashflowSection />,
  categories: () => <CategoriesSection />,
  trend: () => <TrendSection />,
  upcoming: () => <UpcomingSection />,
  goals: () => <GoalsSection />,
  contacts: () => <ContactsSection />,
  currencies: () => <CurrenciesSection />,
  cardActivity: () => <CardActivitySection />,
  watchlist: () => <WatchlistSection />,
};

function unreadCount(app: AppState): number {
  return app.notifications.filter((n) => !n.read).length;
}

export function HomeScreen() {
  const app = useApp();
  const first = app.profile.displayName.split(' ')[0];
  return (
    <>
      <header className="home-head">
        <Wordmark />
        <span className="spacer" />
        <IconButton label="Search" onClick={() => nav.push('search')}>
          <Search size={21} />
        </IconButton>
        <IconButton label="Notifications" onClick={() => nav.push('notifications')} badge={unreadCount(app)}>
          <Bell size={21} />
        </IconButton>
        <IconButton label="Settings" onClick={() => nav.open('profile', 'settings')}>
          <Settings size={21} />
        </IconButton>
        <button className="icon-btn" aria-label="Profile" onClick={() => nav.tab('profile')}>
          <Avatar name={app.profile.displayName} color={app.profile.avatarColor} image={app.profile.avatarImage} size={34} />
        </button>
      </header>
      <div className="scroll">
        <div className="greeting">
          <h1>
            {greetingFor(new Date())}, {first}
          </h1>
          <p>
            Your Money. Your Universe. <Badge tone="sim">Simulator</Badge>
          </p>
        </div>
        <BalanceHero />
        {app.settings.dashboard
          .filter((s) => s.visible)
          .map((s) => (
            <div key={s.id}>{SECTION_COMPONENT[s.id]()}</div>
          ))}
        <p className="disclaimer center" style={{ marginTop: 28 }}>
          VELTRIX is a simulator. Every balance, card, account, credit figure and trade is fictional. No real money moves.
        </p>
      </div>
    </>
  );
}
