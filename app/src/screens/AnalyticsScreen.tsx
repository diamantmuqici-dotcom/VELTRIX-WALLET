import { ChartColumn } from 'lucide-react';
import { useMemo, useState } from 'react';
import { analyticsEntries, compareRanges, currenciesWithActivity, trend, type Bucket } from '../domain/analytics';
import type { CurrencyCode } from '../domain/currency';
import { addDays, addMonths, dayKey, endOfDay, endOfMonth, formatMonthKey, parseDayKey, startOfDay, startOfMonth } from '../domain/dates';
import { CATEGORY_LABEL } from '../domain/labels';
import { percentChange } from '../domain/money';
import { useApp } from '../state/store';
import { nav } from '../state/ui';
import { CATEGORY_COLOR, CHART } from '../ui/tokens';
import { BarChart, Donut } from '../ui/components/charts';
import { CategoryGlyph } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { Chip, EmptyState, Field, Page, ProgressBar, Section, Segmented } from '../ui/components/primitives';

type Period = 'month' | 'last' | '3m' | 'year' | 'custom';

interface Range {
  from: Date;
  to: Date;
  bucket: Bucket;
  prevFrom: Date;
  prevTo: Date;
}

/** Period plus a like-for-like comparison period. */
function periodRange(p: Period, custom: { from: string; to: string }): Range {
  const now = new Date();
  switch (p) {
    case 'month': {
      const from = startOfMonth(now);
      const prevFrom = addMonths(from, -1);
      const prevTo = new Date(Math.min(endOfMonth(prevFrom).getTime(), prevFrom.getTime() + (now.getTime() - from.getTime())));
      return { from, to: now, bucket: 'day', prevFrom, prevTo };
    }
    case 'last': {
      const from = addMonths(startOfMonth(now), -1);
      const prevFrom = addMonths(from, -1);
      return { from, to: endOfMonth(from), bucket: 'day', prevFrom, prevTo: endOfMonth(prevFrom) };
    }
    case '3m': {
      const from = startOfDay(addDays(now, -89));
      return { from, to: now, bucket: 'week', prevFrom: addDays(from, -90), prevTo: new Date(from.getTime() - 1) };
    }
    case 'year': {
      const from = addMonths(startOfMonth(now), -11);
      return { from, to: now, bucket: 'month', prevFrom: addMonths(from, -12), prevTo: new Date(from.getTime() - 1) };
    }
    case 'custom': {
      const from = parseDayKey(custom.from);
      const to = endOfDay(parseDayKey(custom.to));
      const span = to.getTime() - from.getTime();
      const days = span / 86_400_000;
      const prevTo = new Date(from.getTime() - 1);
      return { from, to, bucket: days <= 45 ? 'day' : days <= 200 ? 'week' : 'month', prevFrom: new Date(prevTo.getTime() - span), prevTo };
    }
  }
}

export function AnalyticsScreen() {
  const app = useApp();
  const f = useFmt();
  const [period, setPeriod] = useState<Period>('month');
  const [custom, setCustom] = useState({ from: dayKey(addDays(new Date(), -30)), to: dayKey(new Date()) });
  const curs = useMemo(() => {
    const c = currenciesWithActivity(app);
    return c.includes(app.settings.defaultCurrency) ? c : [app.settings.defaultCurrency, ...c];
  }, [app]);
  const [currency, setCurrency] = useState<CurrencyCode>(app.settings.defaultCurrency);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [view, setView] = useState<'category' | 'account' | 'card'>('category');
  const range = periodRange(period, custom);
  const validCustom = period !== 'custom' || range.from.getTime() <= range.to.getTime();
  const filter = { from: range.from, to: range.to, currency, accountId: accountId ?? undefined };
  const cmp = useMemo(() => (validCustom ? compareRanges(app, filter, range.prevFrom, range.prevTo) : null), [app, filter.from.getTime(), filter.to.getTime(), range.prevFrom.getTime(), currency, accountId, validCustom]);
  const points = useMemo(() => (validCustom ? trend(app, filter, range.bucket) : []), [app, filter.from.getTime(), filter.to.getTime(), currency, accountId, range.bucket, validCustom]);
  const entries = useMemo(() => (validCustom ? analyticsEntries(app, filter) : []), [app, filter.from.getTime(), filter.to.getTime(), currency, accountId, validCustom]);
  const cur = cmp?.current;
  const prev = cmp?.previous;
  const accounts = app.accounts.filter((a) => a.currency === currency && !a.archived);
  const prevLabel = period === 'month' ? 'last month to date' : period === 'last' ? 'the month before' : period === 'year' ? 'prior 12 months' : 'previous period';
  const delta = (a: number, b: number, upGood: boolean) => {
    const p = percentChange(a, b);
    if (p === null) return <span className="faint">no previous data</span>;
    if (Math.round(p) === 0) return <span className="faint">same as {prevLabel}</span>;
    const text = Math.abs(p) >= 1000 ? `${p > 0 ? '>+' : '<−'}999%` : f.pct(p, 0);
    return <span className={(p > 0) === upGood ? 'pos' : 'neg'}>{text} vs {prevLabel}</span>;
  };
  const label = (k: string) => {
    if (range.bucket === 'month') return formatMonthKey(k, f.locale, true);
    const d = parseDayKey(k);
    return range.bucket === 'week' ? f.short(d) : String(d.getDate());
  };
  const breakdown = !cur ? [] : view === 'category' ? cur.byCategory.map((b) => ({ key: b.key, name: CATEGORY_LABEL[b.key], amount: b.amount, share: b.share, color: CATEGORY_COLOR[b.key] })) : view === 'account' ? cur.byAccount.map((b, i) => ({ key: b.key, name: app.accounts.find((a) => a.id === b.key)?.name ?? 'Deleted account', amount: b.amount, share: b.share, color: CHART[i % CHART.length] })) : cur.byCard.map((b, i) => ({ key: b.key, name: app.cards.find((c) => c.id === b.key)?.nickname ?? 'Deleted card', amount: b.amount, share: b.share, color: CHART[i % CHART.length] }));
  return (
    <Page title="Analytics">
      <div className="chips">
        {(
          [
            ['month', 'This month'],
            ['last', 'Last month'],
            ['3m', '90 days'],
            ['year', '12 months'],
            ['custom', 'Custom'],
          ] as Array<[Period, string]>
        ).map(([p, l]) => (
          <Chip key={p} pressed={period === p} onClick={() => setPeriod(p)}>
            {l}
          </Chip>
        ))}
      </div>
      {period === 'custom' && (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Field label="From">
            <input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From date" />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To date" />
          </Field>
        </div>
      )}
      <div className="chips" style={{ marginTop: 10 }}>
        {curs.map((c) => (
          <Chip
            key={c}
            pressed={currency === c}
            onClick={() => {
              setCurrency(c);
              setAccountId(null);
            }}
          >
            {c}
          </Chip>
        ))}
        <span style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
        <Chip pressed={!accountId} onClick={() => setAccountId(null)}>
          All accounts
        </Chip>
        {accounts.map((a) => (
          <Chip key={a.id} pressed={accountId === a.id} onClick={() => setAccountId(a.id)}>
            {a.name}
          </Chip>
        ))}
      </div>

      {!validCustom ? (
        <EmptyState icon={<ChartColumn size={24} />} title="Check the dates">
          The start date must be before the end date.
        </EmptyState>
      ) : !cur || entries.length === 0 ? (
        <EmptyState icon={<ChartColumn size={24} />} title="No activity in this period" action={<button className="btn btn-primary btn-sm" onClick={() => nav.push('send')}>Simulate a payment</button>}>
          Analytics use only your local simulated ledger. Income and spending in {currency} will show up here.
        </EmptyState>
      ) : (
        <>
          <div className="stat-grid" style={{ marginTop: 16 }}>
            <div className="panel stat">
              <div className="label">Income</div>
              <div className="value amount pos">{f.money(cur.income, currency, { sensitive: true })}</div>
              <div className="delta">{prev && delta(cur.income, prev.income, true)}</div>
            </div>
            <div className="panel stat">
              <div className="label">Spending</div>
              <div className="value amount">{f.money(cur.spending, currency, { sensitive: true })}</div>
              <div className="delta">{prev && delta(cur.spending, prev.spending, false)}</div>
            </div>
            <div className="panel stat">
              <div className="label">Net</div>
              <div className={`value amount ${cur.net >= 0 ? 'pos' : 'neg'}`}>{f.money(cur.net, currency, { sign: 'exceptZero', sensitive: true })}</div>
              <div className="delta">{prev && delta(cur.net, prev.net, true)}</div>
            </div>
            <div className="panel stat">
              <div className="label">Average spend</div>
              <div className="value amount">{f.money(cur.averageSpend, currency, { sensitive: true })}</div>
              <div className="delta faint">{cur.spendCount} purchases & payments</div>
            </div>
          </div>
          <Section title={range.bucket === 'month' ? 'Monthly trend' : range.bucket === 'week' ? 'Weekly trend' : 'Daily trend'}>
            <div className="panel pad">
              <div className="hstack xsmall" style={{ gap: 14, marginBottom: 10 }}>
                <span className="hstack" style={{ gap: 6 }}>
                  <span className="legend-dot" style={{ background: 'var(--chart-1)' }} /> Income
                </span>
                <span className="hstack" style={{ gap: 6 }}>
                  <span className="legend-dot" style={{ background: 'var(--chart-5)' }} /> Spending
                </span>
              </div>
              <BarChart data={points.map((p) => ({ label: label(p.key), a: p.income, b: p.spending }))} formatValue={(v) => f.money(v, currency, { compact: true })} labelA="In" labelB="Out" label="Income and spending trend" />
            </div>
          </Section>
          <Section title="Breakdown">
            <Segmented
              value={view}
              onChange={setView}
              label="Breakdown"
              options={[
                { value: 'category', label: 'Category' },
                { value: 'account', label: 'Account' },
                { value: 'card', label: 'Card' },
              ]}
            />
            <div className="panel pad" style={{ marginTop: 12 }}>
              {breakdown.length === 0 ? (
                <div className="muted small center">No spending to break down{view === 'card' ? ' by card' : ''}.</div>
              ) : (
                <>
                  <div className="center" style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                    <Donut slices={breakdown.slice(0, 8).map((b) => ({ value: b.amount, color: b.color, label: b.name }))} size={150} label={`Spending by ${view}`}>
                      <div>
                        <div className="xsmall faint">Spent</div>
                        <div className="strong amount">{f.money(cur.spending, currency, { compact: true, sensitive: true })}</div>
                      </div>
                    </Donut>
                  </div>
                  <div className="stack">
                    {breakdown.map((b) => (
                      <div key={b.key}>
                        <div className="hstack small" style={{ gap: 8, marginBottom: 6 }}>
                          {view === 'category' ? <CategoryGlyph category={b.key as never} size={28} /> : <span className="legend-dot" style={{ background: b.color }} />}
                          <span style={{ flex: 1 }}>{b.name}</span>
                          <span className="amount strong">{f.money(b.amount, currency, { sensitive: true })}</span>
                          <span className="faint" style={{ width: 38, textAlign: 'right' }}>
                            {Math.round(b.share * 100)}%
                          </span>
                        </div>
                        <ProgressBar value={b.share} max={1} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>
          <Section title="Highlights">
            <div className="list">
              {cur.largestSpend && (
                <button className="row" onClick={() => nav.push('txn', { id: cur.largestSpend!.id })}>
                  <div className="row-main">
                    <div className="row-sub">Largest spend</div>
                    <div className="row-title">{cur.largestSpend.title}</div>
                  </div>
                  <div className="row-end row-title amount">{f.money(cur.largestSpend.amount + cur.largestSpend.fee, currency, { sensitive: true })}</div>
                </button>
              )}
              {cur.largestIncome && (
                <button className="row" onClick={() => nav.push('txn', { id: cur.largestIncome!.id })}>
                  <div className="row-main">
                    <div className="row-sub">Largest income</div>
                    <div className="row-title">{cur.largestIncome.title}</div>
                  </div>
                  <div className="row-end row-title amount pos">{f.money(cur.largestIncome.amount, currency, { sensitive: true })}</div>
                </button>
              )}
              <div className="row">
                <div className="row-main">
                  <div className="row-sub">Entries analysed</div>
                  <div className="row-title">{cur.count}</div>
                </div>
                <div className="row-end small muted">
                  Previous period
                  <br />
                  {prev && `${f.short(cmp!.previousFrom)} – ${f.short(cmp!.previousTo)}`}
                </div>
              </div>
            </div>
          </Section>
          <p className="disclaimer">Computed on this device from simulated activity in {currency}. Transfers between your own accounts, exchanges, trades, adjustments and reversed entries are excluded.</p>
        </>
      )}
    </Page>
  );
}
