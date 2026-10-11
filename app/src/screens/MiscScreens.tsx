import { Bell, BellOff, ChartLine, CreditCard, Search, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ASSETS } from '../domain/markets';
import { clearNotifications, markNotificationsRead } from '../domain/ops/planning';
import { EMPTY_FILTER, filterLedger } from '../domain/query';
import { update, useApp } from '../state/store';
import { confirm, nav, type RouteName, type Tab } from '../state/ui';
import { AccountGlyph, Avatar } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { Button, EmptyState, Page, SearchInput, Section } from '../ui/components/primitives';
import { TxnRow } from './common';

const TARGET_TAB: Partial<Record<string, [Tab, RouteName]>> = {
  txn: ['activity', 'txn'],
  requests: ['wallet', 'requests'],
  orders: ['markets', 'orders'],
  card: ['home', 'cardDetail'],
  goals: ['profile', 'goals'],
  bills: ['profile', 'bills'],
  recurring: ['profile', 'recurring'],
  about: ['profile', 'about'],
};

export function NotificationsScreen() {
  const app = useApp();
  const f = useFmt();
  const list = app.notifications;
  return (
    <Page
      title="Notifications"
      right={
        list.some((n) => !n.read) ? (
          <button className="link-btn" onClick={() => update((s) => markNotificationsRead(s))}>
            Read all
          </button>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <EmptyState icon={<BellOff size={24} />} title="You’re all caught up">
          In-app alerts about simulated payments, requests, reminders and orders appear here.
        </EmptyState>
      ) : (
        <>
          <div className="list" style={{ marginTop: 4 }}>
            {list.map((n) => (
              <button
                key={n.id}
                className="row"
                onClick={() => {
                  update((s) => markNotificationsRead(s, [n.id]));
                  const target = n.target ? TARGET_TAB[n.target.screen] : undefined;
                  if (target && n.target) nav.open(target[0], target[1], n.target.params ?? {});
                }}
              >
                <span className="tile-ico" style={!n.read ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' } : undefined}>
                  <Bell size={18} />
                </span>
                <div className="row-main">
                  <div className="row-title" style={{ fontWeight: n.read ? 500 : 700 }}>
                    {n.title}
                  </div>
                  <div className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {n.body}
                  </div>
                </div>
                <div className="row-end xsmall faint">{f.day(n.createdAt)}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <Button
              variant="secondary"
              block
              onClick={async () => {
                if (await confirm({ title: 'Clear all notifications?', message: 'This only clears alerts. Your simulated activity is not affected.', confirmLabel: 'Clear' })) update((s) => clearNotifications(s));
              }}
            >
              Clear all
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}

const SCREEN_INDEX: Array<{ label: string; keywords: string; go: () => void }> = [
  { label: 'Send money', keywords: 'send pay transfer p2p', go: () => nav.push('send') },
  { label: 'Request money', keywords: 'request ask', go: () => nav.push('request') },
  { label: 'Receive', keywords: 'receive qr wallet id', go: () => nav.push('receive') },
  { label: 'Card studio', keywords: 'cards card studio design freeze', go: () => nav.push('cards') },
  { label: 'Exchange / converter', keywords: 'fx exchange currency convert rates', go: () => nav.push('exchange') },
  { label: 'Analytics', keywords: 'analytics spending income charts', go: () => nav.push('analytics') },
  { label: 'Accounts', keywords: 'accounts savings checking credit', go: () => nav.push('accounts') },
  { label: 'Savings goals', keywords: 'goals savings target', go: () => nav.push('goals') },
  { label: 'Budgets', keywords: 'budget limit category', go: () => nav.push('budgets') },
  { label: 'Subscriptions & schedules', keywords: 'recurring subscription schedule standing order', go: () => nav.push('recurring') },
  { label: 'Bill reminders', keywords: 'bills reminder due', go: () => nav.push('bills') },
  { label: 'Appearance', keywords: 'theme dark light accent animation', go: () => nav.push('appearance') },
  { label: 'Data & backup', keywords: 'export csv backup import reset', go: () => nav.push('data') },
  { label: 'Privacy & security', keywords: 'lock privacy hide balances', go: () => nav.push('security') },
];

export function SearchScreen() {
  const app = useApp();
  const f = useFmt();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const txns = useMemo(() => (query.length >= 2 ? filterLedger(app, { ...EMPTY_FILTER, text: query }).slice(0, 12) : []), [app, query]);
  const contacts = query ? app.contacts.filter((c) => `${c.name} ${c.username}`.toLowerCase().includes(query)).slice(0, 6) : [];
  const accounts = query ? app.accounts.filter((a) => !a.archived && `${a.name} ${a.currency}`.toLowerCase().includes(query)).slice(0, 6) : [];
  const cards = query ? app.cards.filter((c) => `${c.nickname} ${c.displayDigits} ${c.style}`.toLowerCase().includes(query)).slice(0, 6) : [];
  const assets = query ? ASSETS.filter((a) => `${a.symbol} ${a.display} ${a.name}`.toLowerCase().includes(query)).slice(0, 6) : [];
  const screens = query ? SCREEN_INDEX.filter((s) => `${s.label} ${s.keywords}`.toLowerCase().includes(query)).slice(0, 5) : [];
  const nothing = query && !txns.length && !contacts.length && !accounts.length && !cards.length && !assets.length && !screens.length;
  return (
    <Page title="Search">
      <SearchInput value={q} onChange={setQ} placeholder="Transactions, contacts, cards, assets…" icon={<Search size={18} />} autoFocus />
      {!query && <p className="muted small center" style={{ marginTop: 24 }}>Search across your simulated ledger, contacts, accounts, cards, market assets and settings.</p>}
      {nothing && <EmptyState icon={<Search size={24} />} title="No results">Try a name, amount, SIM reference or symbol.</EmptyState>}
      {screens.length > 0 && (
        <Section title="Go to">
          <div className="list">
            {screens.map((s) => (
              <button key={s.label} className="row" onClick={s.go}>
                <span className="tile-ico">
                  <Settings size={18} />
                </span>
                <div className="row-main">
                  <div className="row-title">{s.label}</div>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
      {contacts.length > 0 && (
        <Section title="Contacts">
          <div className="list">
            {contacts.map((c) => (
              <button key={c.id} className="row" onClick={() => nav.push('contact', { id: c.id })}>
                <Avatar name={c.name} color={c.color} />
                <div className="row-main">
                  <div className="row-title">{c.name}</div>
                  <div className="row-sub">@{c.username}</div>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
      {accounts.length > 0 && (
        <Section title="Accounts">
          <div className="list">
            {accounts.map((a) => (
              <button key={a.id} className="row" onClick={() => nav.push('account', { id: a.id })}>
                <AccountGlyph icon={a.icon} color={a.color} />
                <div className="row-main">
                  <div className="row-title">{a.name}</div>
                  <div className="row-sub">{a.currency}</div>
                </div>
                <div className="row-end row-title amount">{f.money(a.balance, a.currency, { sensitive: true })}</div>
              </button>
            ))}
          </div>
        </Section>
      )}
      {cards.length > 0 && (
        <Section title="Cards">
          <div className="list">
            {cards.map((c) => (
              <button key={c.id} className="row" onClick={() => nav.push('cardDetail', { id: c.id })}>
                <span className="tile-ico">
                  <CreditCard size={18} />
                </span>
                <div className="row-main">
                  <div className="row-title">{c.nickname}</div>
                  <div className="row-sub">•••• {c.displayDigits}</div>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
      {assets.length > 0 && (
        <Section title="Markets (demo)">
          <div className="list">
            {assets.map((a) => (
              <button key={a.symbol} className="row" onClick={() => nav.push('asset', { symbol: a.symbol })}>
                <span className="tile-ico">
                  <ChartLine size={18} />
                </span>
                <div className="row-main">
                  <div className="row-title">{a.display}</div>
                  <div className="row-sub">{a.name}</div>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
      {txns.length > 0 && (
        <Section title="Transactions">
          <div className="list">
            {txns.map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
