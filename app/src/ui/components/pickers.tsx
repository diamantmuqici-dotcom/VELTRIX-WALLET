import { Check, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CURRENCIES, CURRENCY_CODES, PRIMARY_CURRENCIES, type CurrencyCode } from '../../domain/currency';
import { CATEGORIES, CATEGORY_LABEL } from '../../domain/labels';
import { availableFunds } from '../../domain/ledger';
import { formatMoney } from '../../domain/money';
import type { Account, AppState, Category } from '../../domain/types';
import { closeSheet, openSheet } from '../../state/ui';
import { AccountGlyph, CategoryGlyph, CurrencyBadge } from './Glyphs';
import { SearchInput, tap } from './primitives';

export function SheetHeader({ title, onClose }: { title: ReactNode; onClose: () => void }) {
  return (
    <div className="sheet-head">
      <div className="sheet-title">{title}</div>
      <button className="icon-btn" aria-label="Close" onClick={onClose}>
        <X size={20} />
      </button>
    </div>
  );
}

export interface Option<T> {
  value: T;
  label: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  end?: ReactNode;
  disabled?: boolean;
  search?: string;
}

function OptionList<T>({ title, options, current, onPick, onClose, searchable }: { title: string; options: Option<T>[]; current?: T; onPick: (v: T) => void; onClose: () => void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const shown = q ? options.filter((o) => (o.search ?? String(o.label)).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <>
      <SheetHeader title={title} onClose={onClose} />
      {searchable && (
        <div style={{ marginBottom: 10 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Search" icon={<Search size={18} />} />
        </div>
      )}
      <div className="sheet-body">
        <div className="list">
          {shown.map((o, i) => (
            <button
              key={i}
              type="button"
              className="row"
              disabled={o.disabled}
              style={o.disabled ? { opacity: 0.45 } : undefined}
              onClick={() => {
                tap('select');
                onPick(o.value);
              }}
            >
              {o.icon}
              <div className="row-main">
                <div className="row-title">{o.label}</div>
                {o.sub && <div className="row-sub">{o.sub}</div>}
              </div>
              {o.end && <div className="row-end">{o.end}</div>}
              {current === o.value && <Check size={20} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />}
            </button>
          ))}
          {shown.length === 0 && <div className="empty">No matches</div>}
        </div>
      </div>
    </>
  );
}

/** Opens a bottom sheet with options; resolves with the picked value or null when dismissed. */
export function pick<T>(title: string, options: Option<T>[], current?: T, searchable = false): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const id = openSheet(
      (close) => (
        <OptionList
          title={title}
          options={options}
          current={current}
          searchable={searchable}
          onClose={close}
          onPick={(v) => {
            finish(v);
            closeSheet(id);
          }}
        />
      ),
      { onClose: () => finish(null), tall: options.length > 7 },
    );
  });
}

export function accountOption(a: Account, locale: string, hidden: boolean): Option<string> {
  const avail = availableFunds(a);
  return {
    value: a.id,
    label: a.name,
    sub: a.kind === 'credit' ? `Available credit ${formatMoney(avail, a.currency, { locale, hidden })}` : `${a.currency} · ${formatMoney(a.balance, a.currency, { locale, hidden })}`,
    icon: <AccountGlyph icon={a.icon} color={a.color} size={38} />,
    search: `${a.name} ${a.currency}`,
  };
}

export function pickAccount(app: AppState, opts: { title?: string; current?: string; filter?: (a: Account) => boolean } = {}): Promise<string | null> {
  const list = app.accounts
    .filter((a) => !a.archived && (opts.filter ? opts.filter(a) : true))
    .sort((a, b) => a.order - b.order)
    .map((a) => accountOption(a, app.settings.numberLocale, app.settings.hideBalances));
  return pick(opts.title ?? 'Choose account', list, opts.current);
}

export function pickCurrency(current?: CurrencyCode, title = 'Choose currency', only?: CurrencyCode[]): Promise<CurrencyCode | null> {
  const codes = only ?? [...PRIMARY_CURRENCIES, ...CURRENCY_CODES.filter((c) => !PRIMARY_CURRENCIES.includes(c))];
  return pick(
    title,
    codes.map((c) => ({ value: c, label: `${CURRENCIES[c].name}`, sub: c, icon: <CurrencyBadge code={c} />, search: `${c} ${CURRENCIES[c].name}` })),
    current,
    codes.length > 8,
  );
}

export function pickCategory(current?: Category): Promise<Category | null> {
  return pick(
    'Category',
    CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c], icon: <CategoryGlyph category={c} size={38} /> })),
    current,
  );
}
