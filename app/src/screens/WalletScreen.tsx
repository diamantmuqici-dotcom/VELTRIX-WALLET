import { ArrowLeftRight, ArrowUpRight, Bell, HandCoins, Inbox, QrCode, RotateCcw, Search, StickyNote, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CurrencyCode } from '../domain/currency';
import { PAYMENT_KINDS } from '../domain/ops/common';
import { useApp } from '../state/store';
import { nav } from '../state/ui';
import { Avatar, CurrencyBadge } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { Badge, Row, SearchInput, Section, tap } from '../ui/components/primitives';
import { TxnRow } from './common';
import { openTransferSheet } from './TransferSheet';

export function WalletScreen() {
  const app = useApp();
  const f = useFmt();
  const [noteQ, setNoteQ] = useState('');
  const balances = useMemo(() => {
    const m = new Map<CurrencyCode, { total: number; count: number; firstId: string }>();
    for (const a of app.accounts) {
      if (a.archived || !PAYMENT_KINDS.includes(a.kind)) continue;
      const cur = m.get(a.currency) ?? { total: 0, count: 0, firstId: a.id };
      m.set(a.currency, { total: cur.total + a.balance, count: cur.count + 1, firstId: cur.firstId });
    }
    return [...m.entries()].sort((a, b) => (a[0] === app.settings.defaultCurrency ? -1 : b[0] === app.settings.defaultCurrency ? 1 : b[1].total - a[1].total));
  }, [app.accounts, app.settings.defaultCurrency]);
  const pending = app.requests.filter((r) => r.status === 'pending');
  const p2p = useMemo(() => app.transactions.filter((t) => t.type === 'send' || t.type === 'receive').slice(-6).reverse(), [app.transactions]);
  const refunds = useMemo(() => app.transactions.filter((t) => t.type === 'refund').slice(-4).reverse(), [app.transactions]);
  const notes = useMemo(() => {
    const q = noteQ.trim().toLowerCase();
    return app.transactions
      .filter((t) => t.note && (!q || `${t.note} ${t.title}`.toLowerCase().includes(q)))
      .slice(-60)
      .reverse()
      .slice(0, q ? 20 : 5);
  }, [app.transactions, noteQ]);
  const actions = [
    { label: 'Send', icon: <ArrowUpRight size={20} />, run: () => nav.push('send') },
    { label: 'Request', icon: <HandCoins size={20} />, run: () => nav.push('request') },
    { label: 'Receive', icon: <QrCode size={20} />, run: () => nav.push('receive') },
    { label: 'Transfer', icon: <ArrowLeftRight size={20} />, run: () => openTransferSheet() },
  ];
  return (
    <>
      <header className="topbar" style={{ paddingLeft: 16 }}>
        <h1 className="page-title" style={{ margin: 0, flex: 1 }}>
          Wallet
        </h1>
        <button className="icon-btn" aria-label="Notification preferences" onClick={() => nav.push('notificationPrefs')}>
          <Bell size={20} />
        </button>
      </header>
      <div className="scroll">
        <Section title="Currency balances" className="" action={<button className="link-btn" onClick={() => nav.push('exchange')}>Convert</button>}>
          <div className="list">
            {balances.map(([cur, b]) => (
              <button key={cur} className="row" onClick={() => (b.count === 1 ? nav.push('account', { id: b.firstId }) : nav.push('accounts'))}>
                <CurrencyBadge code={cur} size={40} />
                <div className="row-main">
                  <div className="row-title">{cur}</div>
                  <div className="row-sub">
                    {b.count} account{b.count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="row-end">
                  <div className="row-title amount">{f.money(b.total, cur, { sensitive: true })}</div>
                </div>
              </button>
            ))}
          </div>
        </Section>
        <div className="qa-grid" style={{ marginTop: 18 }}>
          {actions.map((a) => (
            <button
              key={a.label}
              className="qa"
              onClick={() => {
                tap();
                a.run();
              }}
            >
              <span className="qa-ico">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
        <Section title="Requests" action={<button className="link-btn" onClick={() => nav.push('requests')}>All requests</button>}>
          <div className="list">
            {pending.length === 0 ? (
              <Row icon={<span className="tile-ico"><Inbox size={20} /></span>} title="No pending requests" sub="Request money from a fictional contact" onClick={() => nav.push('request')} chevron />
            ) : (
              pending.slice(0, 3).map((r) => (
                <button key={r.id} className="row" onClick={() => nav.push('requests')}>
                  <Avatar name={r.name} color={app.contacts.find((c) => c.id === r.contactId)?.color ?? '#64748B'} />
                  <div className="row-main">
                    <div className="row-title">{r.direction === 'outgoing' ? `You requested from ${r.name}` : `${r.name} requested`}</div>
                    <div className="row-sub">{r.note || f.day(r.createdAt)}</div>
                  </div>
                  <div className="row-end">
                    <div className="row-title amount">{f.money(r.amount, r.currency)}</div>
                    <div className="row-sub">
                      <Badge tone="sim">Pending</Badge>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Section>
        <Section title="Contacts" action={<button className="link-btn" onClick={() => nav.push('contacts')}>Manage</button>}>
          {app.contacts.length ? (
            <div className="hscroll" style={{ gap: 16 }}>
              {app.contacts.slice(0, 10).map((c) => (
                <button key={c.id} className="qa" style={{ flex: '0 0 64px' }} onClick={() => nav.push('contact', { id: c.id })}>
                  <Avatar name={c.name} color={c.color} size={52} />
                  <span style={{ maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="list">
              <Row icon={<span className="tile-ico"><Users size={20} /></span>} title="Add a fictional contact" onClick={() => nav.push('contactEdit')} chevron />
            </div>
          )}
        </Section>
        <Section title="Payment activity" action={<button className="link-btn" onClick={() => nav.tab('activity')}>All activity</button>}>
          {p2p.length ? (
            <div className="list">
              {p2p.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </div>
          ) : (
            <div className="panel pad muted small center">No simulated payments yet.</div>
          )}
        </Section>
        {refunds.length > 0 && (
          <Section title="Refunds">
            <div className="list">
              {refunds.map((t) => (
                <TxnRow key={t.id} t={t} />
              ))}
            </div>
          </Section>
        )}
        <Section title="Note history">
          <SearchInput value={noteQ} onChange={setNoteQ} placeholder="Search your notes" icon={<Search size={18} />} />
          <div className="list" style={{ marginTop: 10 }}>
            {notes.length ? (
              notes.map((t) => (
                <button key={t.id} className="row" onClick={() => nav.push('txn', { id: t.id })}>
                  <span className="tile-ico">
                    <StickyNote size={18} />
                  </span>
                  <div className="row-main">
                    <div className="row-title" style={{ whiteSpace: 'normal' }}>
                      “{t.note}”
                    </div>
                    <div className="row-sub">
                      {t.title} · {f.day(t.createdAt)}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty" style={{ padding: 20 }}>
                {noteQ ? 'No notes match your search.' : 'Notes you add to simulated payments appear here.'}
              </div>
            )}
          </div>
        </Section>
        <Section title="Preferences">
          <div className="list">
            <Row icon={<span className="tile-ico"><Bell size={18} /></span>} title="Notification preferences" sub="Payments, requests, reminders, markets" onClick={() => nav.push('notificationPrefs')} chevron />
            <Row icon={<span className="tile-ico"><RotateCcw size={18} /></span>} title="Refunds & reversals" sub="Open any entry in Activity to refund or reverse it" onClick={() => nav.tab('activity')} chevron />
          </div>
        </Section>
        <p className="disclaimer">An original VELTRIX design for simulated person-to-person payments. Not affiliated with any payment provider.</p>
      </div>
    </>
  );
}
