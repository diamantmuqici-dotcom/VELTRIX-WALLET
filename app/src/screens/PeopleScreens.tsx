import { ArrowUpRight, Ban, Check, HandCoins, Inbox, Pencil, Search, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { REQUEST_STATUS_LABEL } from '../domain/labels';
import { createContact, deleteContact, toggleFavorite, updateContact, validateContact, type ContactInput } from '../domain/ops/entities';
import { resolveRequest } from '../domain/ops/payments';
import { AVATAR_COLORS } from '../domain/presets';
import type { PaymentRequest } from '../domain/types';
import { act } from '../state/actions';
import { update, useApp } from '../state/store';
import { confirm, nav } from '../state/ui';
import { Avatar } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { Badge, Button, EmptyState, Field, Page, SearchInput, Section, Segmented, TextArea, TextInput, ToggleRow, useScreen } from '../ui/components/primitives';
import { TxnRow } from './common';

export function ContactsScreen() {
  const app = useApp();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return [...app.contacts]
      .filter((c) => !query || `${c.name} @${c.username} ${c.identifier} ${c.note}`.toLowerCase().includes(query))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  }, [app.contacts, q]);
  return (
    <Page
      title="Contacts"
      right={
        <button className="icon-btn" aria-label="New contact" onClick={() => nav.push('contactEdit')}>
          <UserPlus size={21} />
        </button>
      }
    >
      <SearchInput value={q} onChange={setQ} placeholder="Search contacts" icon={<Search size={18} />} />
      <div style={{ marginTop: 12 }}>
        {list.length ? (
          <div className="list">
            {list.map((c) => (
              <button key={c.id} className="row" onClick={() => nav.push('contact', { id: c.id })}>
                <Avatar name={c.name} color={c.color} />
                <div className="row-main">
                  <div className="row-title">
                    {c.name} {c.favorite && <Star size={13} fill="currentColor" style={{ color: 'var(--warning)', verticalAlign: -1 }} />}
                  </div>
                  <div className="row-sub">
                    @{c.username}
                    {c.note ? ` · ${c.note}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Users size={24} />} title={q ? 'No matches' : 'No contacts yet'} action={!q && <Button size="sm" onClick={() => nav.push('contactEdit')}>Add fictional contact</Button>}>
            {q ? 'Try another name or username.' : 'Contacts are fictional people stored only on this device. VELTRIX never reads your phone’s contacts.'}
          </EmptyState>
        )}
      </div>
    </Page>
  );
}

export function ContactScreen() {
  const { route } = useScreen();
  const app = useApp();
  const c = app.contacts.find((x) => x.id === route.params.id);
  const history = useMemo(() => (c ? app.transactions.filter((t) => t.counterparty?.contactId === c.id).reverse() : []), [app.transactions, c]);
  if (!c) {
    return (
      <Page title="Contact">
        <EmptyState icon={<Users size={24} />} title="Contact not found" />
      </Page>
    );
  }
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${c.name}?`, message: 'The contact is removed. Past simulated payments keep the name in your history.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    const r = act((s) => deleteContact(s, c.id), { success: 'Contact deleted' });
    if (r.ok) nav.pop();
  };
  return (
    <Page
      title=""
      right={
        <button className="icon-btn" aria-label="Edit contact" onClick={() => nav.push('contactEdit', { id: c.id })}>
          <Pencil size={20} />
        </button>
      }
    >
      <div className="center" style={{ marginTop: 4 }}>
        <div style={{ display: 'inline-block' }}>
          <Avatar name={c.name} color={c.color} size={76} />
        </div>
        <h2 style={{ margin: '12px 0 2px' }}>{c.name}</h2>
        <div className="muted">@{c.username}</div>
        {c.identifier && <div className="faint small" style={{ marginTop: 2 }}>{c.identifier}</div>}
        {c.note && <div className="small" style={{ marginTop: 8 }}>{c.note}</div>}
        <div style={{ marginTop: 8 }}>
          <Badge tone="muted">Fictional contact</Badge>
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 20 }}>
        <Button icon={<ArrowUpRight size={18} />} onClick={() => nav.push('send', { contactId: c.id })}>
          Send
        </Button>
        <Button variant="secondary" icon={<HandCoins size={18} />} onClick={() => nav.push('request', { contactId: c.id })}>
          Request
        </Button>
      </div>
      <div className="list" style={{ marginTop: 16 }}>
        <ToggleRow title="Favorite" sub="Show on Home and at the top of lists" checked={c.favorite} onChange={() => update((s) => toggleFavorite(s, c.id))} icon={<Star size={18} className="faint" />} />
      </div>
      <Section title={`History with ${c.name.split(' ')[0]} (${history.length})`}>
        {history.length ? (
          <div className="list">
            {history.slice(0, 50).map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </div>
        ) : (
          <div className="panel pad muted small center">No simulated payments with this contact yet.</div>
        )}
      </Section>
      <div style={{ marginTop: 18 }}>
        <Button variant="danger" block icon={<Trash2 size={18} />} onClick={remove}>
          Delete contact
        </Button>
      </div>
    </Page>
  );
}

export function ContactEditScreen() {
  const { route } = useScreen();
  const app = useApp();
  const existing = route.params.id ? app.contacts.find((c) => c.id === route.params.id) : undefined;
  const [d, setD] = useState<ContactInput>(() =>
    existing
      ? { name: existing.name, username: existing.username, identifier: existing.identifier, color: existing.color, note: existing.note, favorite: existing.favorite }
      : { name: '', username: '', identifier: '', color: AVATAR_COLORS[app.contacts.length % AVATAR_COLORS.length], note: '', favorite: false },
  );
  const [touched, setTouched] = useState(false);
  const err = validateContact(app, d, existing?.id);
  const patch = (p: Partial<ContactInput>) => setD((x) => ({ ...x, ...p }));
  const save = () => {
    setTouched(true);
    if (err) return;
    if (existing) {
      const r = act((s) => updateContact(s, existing.id, d), { success: 'Contact saved' });
      if (r.ok) nav.pop();
    } else {
      const r = act((s, ctx) => createContact(s, d, ctx), { success: 'Fictional contact added' });
      if (r.ok) nav.replace('contact', { id: r.contact.id });
    }
  };
  const fe = (field: keyof ContactInput) => (touched && err?.field === field ? err.message : null);
  return (
    <Page title={existing ? 'Edit contact' : 'New contact'} footer={<Button block onClick={save}>{existing ? 'Save' : 'Add contact'}</Button>}>
      <div className="center" style={{ margin: '4px 0 16px' }}>
        <div style={{ display: 'inline-block' }}>
          <Avatar name={d.name || '?'} color={d.color} size={72} />
        </div>
      </div>
      <Field label="Name" error={fe('name')}>
        <TextInput value={d.name} onChange={(v) => patch({ name: v })} placeholder="Fictional name" maxLength={40} autoCapitalize="words" />
      </Field>
      <Field label="Username" error={fe('username')} hint="Fictional handle, e.g. @jordan.vale">
        <TextInput value={d.username} onChange={(v) => patch({ username: v })} placeholder="@username" autoCapitalize="none" maxLength={21} />
      </Field>
      <Field label="E-mail or phone style identifier (optional)" error={fe('identifier')} hint="Display only — VELTRIX never contacts anyone">
        <TextInput value={d.identifier} onChange={(v) => patch({ identifier: v })} placeholder="name@example.com" autoCapitalize="none" />
      </Field>
      <Field label="Note (optional)" error={fe('note')}>
        <TextArea value={d.note} onChange={(v) => patch({ note: v })} rows={2} placeholder="e.g. Book club" />
      </Field>
      <Field label="Avatar color">
        <div className="swatches">
          {AVATAR_COLORS.map((c) => (
            <button key={c} className="swatch" aria-label={`Color ${c}`} aria-pressed={d.color === c} style={{ background: c }} onClick={() => patch({ color: c })} />
          ))}
        </div>
      </Field>
      <div className="list">
        <ToggleRow title="Favorite" checked={d.favorite} onChange={(v) => patch({ favorite: v })} />
      </div>
    </Page>
  );
}

/* ------------------------------ Requests ----------------------------- */

function RequestRow({ r }: { r: PaymentRequest }) {
  const app = useApp();
  const f = useFmt();
  const color = app.contacts.find((c) => c.id === r.contactId)?.color ?? '#64748B';
  const resolve = (action: 'accept' | 'cancel' | 'pay' | 'decline', msg: string) => act((s, ctx) => resolveRequest(s, r.id, action, ctx), { success: msg });
  return (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Avatar name={r.name} color={color} />
      <div className="row-main">
        <div className="row-title">{r.direction === 'outgoing' ? `You requested from ${r.name}` : `${r.name} requested from you`}</div>
        <div className="row-sub">
          {r.note ? `“${r.note}” · ` : ''}
          {f.day(r.createdAt)}
        </div>
      </div>
      <div className="row-end">
        <div className="row-title amount">{f.money(r.amount, r.currency)}</div>
        <div className="row-sub">
          <Badge tone={r.status === 'pending' ? 'sim' : r.status === 'accepted' || r.status === 'paid' ? 'pos' : 'muted'}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
        </div>
      </div>
      {r.status === 'pending' && (
        <div className="btn-row" style={{ width: '100%', marginTop: 10, paddingLeft: 54 }}>
          {r.direction === 'outgoing' ? (
            <>
              <Button size="sm" variant="secondary" icon={<Ban size={16} />} onClick={() => resolve('cancel', 'Request canceled')}>
                Cancel
              </Button>
              <Button size="sm" icon={<Check size={16} />} onClick={() => resolve('accept', 'Marked accepted (simulated)')}>
                Mark accepted
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => resolve('decline', 'Request declined')}>
                Decline
              </Button>
              <Button size="sm" onClick={() => resolve('pay', 'Simulated payment sent')}>
                Pay
              </Button>
            </>
          )}
        </div>
      )}
      {r.status !== 'pending' && r.txnId && (
        <button className="link-btn" style={{ width: '100%', textAlign: 'left', paddingLeft: 54 }} onClick={() => nav.push('txn', { id: r.txnId })}>
          View ledger entry
        </button>
      )}
    </div>
  );
}

export function RequestsScreen() {
  const app = useApp();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const list = app.requests.filter((r) => tab === 'all' || r.status === 'pending');
  return (
    <Page
      title="Requests"
      right={
        <button className="icon-btn" aria-label="New request" onClick={() => nav.push('request')}>
          <HandCoins size={21} />
        </button>
      }
    >
      <Segmented
        value={tab}
        onChange={setTab}
        label="Request filter"
        options={[
          { value: 'pending', label: `Pending (${app.requests.filter((r) => r.status === 'pending').length})` },
          { value: 'all', label: 'All' },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        {list.length ? (
          <div className="list">
            {list.map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Inbox size={24} />} title={tab === 'pending' ? 'Nothing pending' : 'No requests yet'} action={<Button size="sm" onClick={() => nav.push('request')}>Request money</Button>}>
            Requests are simulated. Mark them accepted or canceled whenever you like.
          </EmptyState>
        )}
      </div>
      <p className="disclaimer">Accepting a request adds a simulated incoming payment to the receiving account. Nobody is actually charged.</p>
    </Page>
  );
}
