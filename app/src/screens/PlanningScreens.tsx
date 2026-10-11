import { CalendarClock, Pause, Play, Plus, Receipt, Target, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '../domain/currency';
import { addDays, addMonths, dayKey, daysBetween, parseDayKey } from '../domain/dates';
import { CATEGORIES, CATEGORY_LABEL } from '../domain/labels';
import { minorToKeypadText, parseAmount } from '../domain/money';
import { MAIN_ACCOUNT_ID, PAYMENT_KINDS } from '../domain/ops/common';
import { sortedCards } from '../domain/ops/entities';
import {
  budgetStatus,
  createBill,
  createGoal,
  createRule,
  deleteBill,
  deleteGoal,
  deleteRule,
  monthlyEquivalent,
  moveGoalFunds,
  payBill,
  removeBudget,
  runRuleOnce,
  setBudget,
  updateBill,
  updateGoal,
  updateRule,
  type RuleInput,
} from '../domain/ops/planning';
import { ACCOUNT_COLORS } from '../domain/presets';
import type { AccountIcon, AppState, BillReminder, Category, Frequency, RecurringRule, SavingsGoal } from '../domain/types';
import { act, newOpKey } from '../state/actions';
import { getSnapshot, update, useApp } from '../state/store';
import { confirm, openSheet, toast } from '../state/ui';
import { AccountGlyph, CategoryGlyph } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { pick, pickAccount, pickCategory, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, EmptyState, Field, Page, ProgressBar, Section, Segmented, TextInput, ToggleRow } from '../ui/components/primitives';

const FREQ_LABEL: Record<Frequency, string> = { once: 'Once', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' };

function amountOf(text: string, currency: CurrencyCode): number | null {
  const r = parseAmount(text, CURRENCIES[currency].decimals);
  return r.ok ? r.minor : null;
}

function AccountSelect({ label, value, onChange, filter }: { label: string; value: string; onChange: (id: string) => void; filter?: (a: AppState['accounts'][number]) => boolean }) {
  const app = useApp();
  const f = useFmt();
  const acc = app.accounts.find((a) => a.id === value);
  return (
    <Field label={label}>
      <button
        className="select-btn"
        onClick={async () => {
          const id = await pickAccount(getSnapshot().app!, { current: value, title: label, filter });
          if (id) onChange(id);
        }}
      >
        {acc && <AccountGlyph icon={acc.icon} color={acc.color} size={32} />}
        <div className="row-main">
          <div className="row-title">{acc?.name ?? 'Choose account'}</div>
          {acc && <div className="row-sub">{f.money(acc.balance, acc.currency, { sensitive: true })}</div>}
        </div>
        <span className="link-btn">Change</span>
      </button>
    </Field>
  );
}

/* -------------------------------- Goals ------------------------------- */

const GOAL_ICONS: AccountIcon[] = ['vault', 'plane', 'home', 'briefcase', 'gem', 'piggy'];

function GoalSheet({ goal, close }: { goal?: SavingsGoal; close: () => void }) {
  const app = useApp();
  const savings = app.accounts.find((a) => a.kind === 'savings' && !a.archived) ?? app.accounts.find((a) => a.id === MAIN_ACCOUNT_ID)!;
  const [name, setName] = useState(goal?.name ?? '');
  const [accountId, setAccountId] = useState(goal?.accountId ?? savings.id);
  const acc = app.accounts.find((a) => a.id === accountId)!;
  const [target, setTarget] = useState(goal ? minorToKeypadText(goal.target, CURRENCIES[goal.currency].decimals) : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? dayKey(addMonths(new Date(), 6)));
  const [icon, setIcon] = useState<AccountIcon>(goal?.icon ?? 'vault');
  const [color, setColor] = useState(goal?.color ?? ACCOUNT_COLORS[3]);
  const t = amountOf(target, goal?.currency ?? acc.currency);
  const save = () => {
    if (!t) return;
    const r = goal
      ? act((s) => updateGoal(s, goal.id, { name, target: t, deadline: deadline || null, icon, color }), { success: 'Goal saved' })
      : act((s, ctx) => createGoal(s, { name, target: t, deadline: deadline || null, icon, color, accountId }, ctx), { success: 'Goal created' });
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title={goal ? 'Edit goal' : 'New savings goal'} onClose={close} />
      <div className="sheet-body">
        <Field label="Name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Summer trip" maxLength={40} autoCapitalize="sentences" />
        </Field>
        {!goal && <AccountSelect label="Goal money is kept in" value={accountId} onChange={setAccountId} filter={(a) => PAYMENT_KINDS.includes(a.kind)} />}
        <Field label={`Target (${goal?.currency ?? acc.currency})`}>
          <TextInput value={target} onChange={setTarget} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Target date (optional)">
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-label="Target date" />
        </Field>
        <Field label="Icon">
          <div className="chips wrap">
            {GOAL_ICONS.map((i) => (
              <button key={i} className="chip" aria-pressed={icon === i} onClick={() => setIcon(i)} aria-label={i} style={{ padding: 4 }}>
                <AccountGlyph icon={i} color={color} size={30} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <div className="swatches">
            {ACCOUNT_COLORS.map((c) => (
              <button key={c} className="swatch" aria-label={`Color ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </Field>
      </div>
      <div className="sheet-foot">
        <Button block disabled={!name.trim() || !t} onClick={save}>
          {goal ? 'Save goal' : 'Create goal'}
        </Button>
      </div>
    </>
  );
}

function GoalMoveSheet({ goal, direction, close }: { goal: SavingsGoal; direction: 'contribute' | 'withdraw'; close: () => void }) {
  const app = useApp();
  const f = useFmt();
  const candidates = app.accounts.filter((a) => !a.archived && a.id !== goal.accountId && a.currency === goal.currency && a.kind !== 'credit');
  const [other, setOther] = useState(candidates[0]?.id ?? '');
  const [text, setText] = useState('');
  const [opKey] = useState(() => newOpKey('goal'));
  const amount = amountOf(text, goal.currency);
  const goalAcc = app.accounts.find((a) => a.id === goal.accountId);
  return (
    <>
      <SheetHeader title={direction === 'contribute' ? `Add to ${goal.name}` : `Withdraw from ${goal.name}`} onClose={close} />
      <div className="sheet-body">
        {candidates.length === 0 ? (
          <p className="muted small">You need another {goal.currency} account to move money {direction === 'contribute' ? 'from' : 'to'}.</p>
        ) : (
          <>
            <AccountSelect label={direction === 'contribute' ? 'From' : 'To'} value={other} onChange={setOther} filter={(a) => a.id !== goal.accountId && a.currency === goal.currency && a.kind !== 'credit'} />
            <Field label={`Amount (${goal.currency})`} hint={direction === 'withdraw' ? `Goal holds ${f.money(goal.saved, goal.currency)}` : `Moves into ${goalAcc?.name ?? 'the goal account'}`}>
              <TextInput value={text} onChange={setText} inputMode="decimal" placeholder="0" autoFocus />
            </Field>
          </>
        )}
      </div>
      <div className="sheet-foot">
        <Button
          block
          disabled={!amount || !other}
          onClick={() => {
            const r = act((s, ctx) => moveGoalFunds(s, { goalId: goal.id, otherAccountId: other, amount: amount!, direction, opKey }, ctx), { success: direction === 'contribute' ? 'Saved toward your goal' : 'Withdrawn from goal' });
            if (r.ok) close();
          }}
        >
          {direction === 'contribute' ? 'Add money' : 'Withdraw'}
        </Button>
      </div>
    </>
  );
}

export function GoalsScreen() {
  const app = useApp();
  const f = useFmt();
  const remove = async (g: SavingsGoal) => {
    const ok = await confirm({ title: `Delete ${g.name}?`, message: 'The goal tracker is removed. Money already moved stays in its account and the transfers remain in your history.', confirmLabel: 'Delete', destructive: true });
    if (ok) {
      update((s) => deleteGoal(s, g.id));
      toast('Goal deleted', 'success');
    }
  };
  return (
    <Page
      title="Savings goals"
      right={
        <button className="icon-btn" aria-label="New goal" onClick={() => openSheet((close) => <GoalSheet close={close} />, { tall: true })}>
          <Plus size={22} />
        </button>
      }
    >
      {app.goals.length === 0 ? (
        <EmptyState icon={<Target size={24} />} title="No goals yet" action={<Button size="sm" onClick={() => openSheet((close) => <GoalSheet close={close} />, { tall: true })}>Create a goal</Button>}>
          Set a fictional target and move simulated money toward it with real ledger transfers.
        </EmptyState>
      ) : (
        <div className="stack" style={{ marginTop: 4 }}>
          {app.goals.map((g) => {
            const pct = g.target ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
            const days = g.deadline ? daysBetween(new Date(), parseDayKey(g.deadline)) : null;
            const perMonth = days && days > 0 && g.saved < g.target ? Math.ceil(((g.target - g.saved) / days) * 30.4) : 0;
            return (
              <div key={g.id} className="panel pad">
                <div className="hstack">
                  <AccountGlyph icon={g.icon} color={g.color} />
                  <div className="row-main">
                    <div className="strong">{g.name}</div>
                    <div className="small muted">
                      {g.deadline ? (days !== null && days >= 0 ? `${days} days left` : 'Target date passed') : 'No target date'} · in {app.accounts.find((a) => a.id === g.accountId)?.name ?? '—'}
                    </div>
                  </div>
                  {pct >= 100 && <Badge tone="pos">Reached</Badge>}
                </div>
                <div className="hstack small" style={{ justifyContent: 'space-between', margin: '12px 0 8px' }}>
                  <span className="amount strong">{f.money(g.saved, g.currency, { sensitive: true })}</span>
                  <span className="muted amount">
                    of {f.money(g.target, g.currency)} · {pct}%
                  </span>
                </div>
                <ProgressBar value={g.saved} max={g.target} />
                {perMonth > 0 && <div className="xsmall faint" style={{ marginTop: 8 }}>About {f.money(perMonth, g.currency)} per month to reach it on time</div>}
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <Button size="sm" onClick={() => openSheet((close) => <GoalMoveSheet goal={g} direction="contribute" close={close} />)}>
                    Add money
                  </Button>
                  <Button size="sm" variant="secondary" disabled={g.saved <= 0} onClick={() => openSheet((close) => <GoalMoveSheet goal={g} direction="withdraw" close={close} />)}>
                    Withdraw
                  </Button>
                </div>
                <div className="hstack" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                  <button className="link-btn" onClick={() => openSheet((close) => <GoalSheet goal={g} close={close} />, { tall: true })}>
                    Edit
                  </button>
                  <button className="link-btn" style={{ color: 'var(--negative)' }} onClick={() => void remove(g)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/* ------------------------------- Budgets ------------------------------ */

function BudgetSheet({ category, close }: { category?: Category; close: () => void }) {
  const app = useApp();
  const existing = category ? app.budgets.find((b) => b.category === category) : undefined;
  const [cat, setCat] = useState<Category>(category ?? 'food');
  const cur = existing?.currency ?? app.settings.defaultCurrency;
  const [text, setText] = useState(existing ? minorToKeypadText(existing.limit, CURRENCIES[cur].decimals) : '');
  const amount = amountOf(text, cur);
  return (
    <>
      <SheetHeader title={existing ? `Budget · ${CATEGORY_LABEL[cat]}` : 'New monthly budget'} onClose={close} />
      <div className="sheet-body">
        {!existing && (
          <Field label="Category">
            <button
              className="select-btn"
              onClick={async () => {
                const c = await pickCategory(cat);
                if (c) setCat(c);
              }}
            >
              <CategoryGlyph category={cat} size={32} />
              <div className="row-main">
                <div className="row-title">{CATEGORY_LABEL[cat]}</div>
              </div>
              <span className="link-btn">Change</span>
            </button>
          </Field>
        )}
        <Field label={`Monthly limit (${cur})`}>
          <TextInput value={text} onChange={setText} inputMode="decimal" placeholder="0" autoFocus />
        </Field>
      </div>
      <div className="sheet-foot btn-row">
        {existing && (
          <Button
            variant="danger"
            onClick={() => {
              update((s) => removeBudget(s, cat));
              toast('Budget removed', 'success');
              close();
            }}
          >
            Remove
          </Button>
        )}
        <Button
          disabled={!amount}
          onClick={() => {
            const r = act((s, ctx) => setBudget(s, cat, amount!, cur, ctx), { success: 'Budget saved' });
            if (r.ok) close();
          }}
        >
          Save
        </Button>
      </div>
    </>
  );
}

export function BudgetsScreen() {
  const app = useApp();
  const f = useFmt();
  const status = useMemo(() => budgetStatus(app, new Date()), [app]);
  const unused = CATEGORIES.filter((c) => !app.budgets.some((b) => b.category === c) && c !== 'income' && c !== 'transfers' && c !== 'investing');
  return (
    <Page
      title="Monthly budgets"
      right={
        <button className="icon-btn" aria-label="New budget" onClick={() => openSheet((close) => <BudgetSheet category={undefined} close={close} />)} disabled={!unused.length}>
          <Plus size={22} />
        </button>
      }
    >
      {status.length === 0 ? (
        <EmptyState icon={<Wallet size={24} />} title="No budgets yet" action={<Button size="sm" onClick={() => openSheet((close) => <BudgetSheet close={close} />)}>Create a budget</Button>}>
          Budgets track this month’s simulated spending per category (net of refunds).
        </EmptyState>
      ) : (
        <div className="list" style={{ marginTop: 4 }}>
          {status.map(({ budget, spent, ratio }) => (
            <button key={budget.id} className="row" onClick={() => openSheet((close) => <BudgetSheet category={budget.category} close={close} />)}>
              <CategoryGlyph category={budget.category} />
              <div className="row-main">
                <div className="hstack" style={{ justifyContent: 'space-between' }}>
                  <span className="row-title">{CATEGORY_LABEL[budget.category]}</span>
                  <span className={`small amount ${ratio > 1 ? 'neg' : 'muted'}`}>
                    {f.money(spent, budget.currency)} / {f.money(budget.limit, budget.currency)}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <ProgressBar value={spent} max={budget.limit} tone="auto" />
                </div>
                <div className="xsmall faint" style={{ marginTop: 6 }}>
                  {ratio > 1 ? `${f.money(spent - budget.limit, budget.currency)} over budget` : `${f.money(budget.limit - spent, budget.currency)} left this month`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ----------------------------- Recurring ------------------------------ */

function RuleSheet({ rule, close }: { rule?: RecurringRule; close: () => void }) {
  const app = useApp();
  const [kind, setKind] = useState<RuleInput['kind']>(rule?.kind ?? 'purchase');
  const [title, setTitle] = useState(rule?.title ?? '');
  const [fromId, setFromId] = useState(rule?.fromAccountId ?? MAIN_ACCOUNT_ID);
  const from = app.accounts.find((a) => a.id === fromId) ?? app.accounts[0];
  const [toId, setToId] = useState(rule?.toAccountId ?? app.accounts.find((a) => a.id !== fromId && a.currency === from.currency && !a.archived)?.id ?? '');
  const [contactId, setContactId] = useState(rule?.contactId ?? app.contacts[0]?.id ?? '');
  const [cardId, setCardId] = useState(rule?.cardId ?? sortedCards(app).find((c) => c.accountId === fromId)?.id ?? '');
  const [text, setText] = useState(rule ? minorToKeypadText(rule.amount, CURRENCIES[rule.currency].decimals) : '');
  const [freq, setFreq] = useState<Frequency>(rule?.frequency ?? 'monthly');
  const [next, setNext] = useState(rule?.nextDate ?? dayKey(addDays(new Date(), 1)));
  const [category, setCategory] = useState<Category>(rule?.category ?? 'subscriptions');
  const [isSub, setIsSub] = useState(rule?.isSubscription ?? true);
  const amount = amountOf(text, from.currency);
  const cards = sortedCards(app).filter((c) => c.accountId === fromId);
  const input: RuleInput = {
    kind,
    title,
    amount: amount ?? 0,
    currency: from.currency,
    fromAccountId: fromId,
    toAccountId: kind === 'transfer' ? toId : undefined,
    contactId: kind === 'send' || kind === 'receive' ? contactId || undefined : undefined,
    cardId: kind === 'purchase' ? cardId || undefined : undefined,
    category: kind === 'transfer' ? 'transfers' : kind === 'receive' ? 'income' : category,
    note: '',
    frequency: freq,
    nextDate: next,
    active: rule?.active ?? true,
    isSubscription: kind === 'purchase' && isSub,
  };
  const save = () => {
    const r = rule ? act((s) => updateRule(s, rule.id, input), { success: 'Schedule saved' }) : act((s, ctx) => createRule(s, input, ctx), { success: 'Schedule created' });
    if (r.ok) close();
  };
  return (
    <>
      <SheetHeader title={rule ? 'Edit schedule' : 'New scheduled simulation'} onClose={close} />
      <div className="sheet-body">
        <Field label="Type">
          <Segmented
            value={kind}
            onChange={setKind}
            small
            label="Schedule type"
            options={[
              { value: 'purchase', label: 'Subscription' },
              { value: 'send', label: 'Send' },
              { value: 'transfer', label: 'Transfer' },
              { value: 'receive', label: 'Income' },
            ]}
          />
        </Field>
        <Field label="Title">
          <TextInput value={title} onChange={setTitle} placeholder={kind === 'purchase' ? 'e.g. StreamBox' : kind === 'transfer' ? 'e.g. Monthly savings' : 'e.g. Rent'} maxLength={40} />
        </Field>
        <AccountSelect label={kind === 'receive' ? 'Deposit to' : 'From'} value={fromId} onChange={(id) => setFromId(id)} filter={(a) => (kind === 'transfer' ? a.kind !== 'credit' : kind === 'purchase' ? a.kind !== 'investment' : PAYMENT_KINDS.includes(a.kind))} />
        {kind === 'transfer' && <AccountSelect label="To" value={toId} onChange={setToId} filter={(a) => a.id !== fromId && a.currency === from.currency} />}
        {(kind === 'send' || kind === 'receive') && app.contacts.length > 0 && (
          <Field label={kind === 'send' ? 'Recipient' : 'From'}>
            <button
              className="select-btn"
              onClick={async () => {
                const id = await pick('Contact', app.contacts.map((c) => ({ value: c.id, label: c.name, sub: `@${c.username}` })), contactId, app.contacts.length > 7);
                if (id) setContactId(id);
              }}
            >
              <div className="row-main">
                <div className="row-title">{app.contacts.find((c) => c.id === contactId)?.name ?? 'Use the title as name'}</div>
              </div>
              <span className="link-btn">Change</span>
            </button>
          </Field>
        )}
        {kind === 'purchase' && (
          <Field label="Charged to card">
            <button
              className="select-btn"
              onClick={async () => {
                const id = await pick('Card', [{ value: '', label: 'No card (direct payment)' }, ...cards.map((c) => ({ value: c.id, label: c.nickname, sub: `•••• ${c.displayDigits}` }))], cardId);
                if (id !== null) setCardId(id);
              }}
            >
              <div className="row-main">
                <div className="row-title">{cards.find((c) => c.id === cardId)?.nickname ?? 'No card'}</div>
              </div>
              <span className="link-btn">Change</span>
            </button>
          </Field>
        )}
        <Field label={`Amount (${from.currency})`}>
          <TextInput value={text} onChange={setText} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Repeats">
          <div className="chips wrap">
            {(Object.keys(FREQ_LABEL) as Frequency[]).map((fq) => (
              <button key={fq} className="chip" aria-pressed={freq === fq} onClick={() => setFreq(fq)}>
                {FREQ_LABEL[fq]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Next date">
          <input className="input" type="date" value={next} onChange={(e) => setNext(e.target.value)} aria-label="Next date" />
        </Field>
        {(kind === 'purchase' || kind === 'send') && (
          <Field label="Category">
            <button
              className="select-btn"
              onClick={async () => {
                const c = await pickCategory(category);
                if (c) setCategory(c);
              }}
            >
              <CategoryGlyph category={category} size={30} />
              <div className="row-main">
                <div className="row-title">{CATEGORY_LABEL[category]}</div>
              </div>
            </button>
          </Field>
        )}
        {kind === 'purchase' && (
          <div className="list">
            <ToggleRow title="Subscription" sub="Listed under subscriptions" checked={isSub} onChange={setIsSub} />
          </div>
        )}
        <p className="disclaimer">Due schedules run automatically when you open VELTRIX — nothing runs in the background. Each occurrence is recorded once, even after restarts.</p>
      </div>
      <div className="sheet-foot">
        <Button block disabled={!title.trim() || !amount} onClick={save}>
          {rule ? 'Save' : 'Create schedule'}
        </Button>
      </div>
    </>
  );
}

export function RecurringScreen() {
  const app = useApp();
  const f = useFmt();
  const subs = app.recurring.filter((r) => r.isSubscription);
  const others = app.recurring.filter((r) => !r.isSubscription);
  const monthlySubs = new Map<CurrencyCode, number>();
  for (const r of subs) if (r.active) monthlySubs.set(r.currency, (monthlySubs.get(r.currency) ?? 0) + monthlyEquivalent(r));
  const open = (r?: RecurringRule) => openSheet((close) => <RuleSheet rule={r} close={close} />, { tall: true });
  const runNow = (r: RecurringRule) =>
    act((s, ctx) => {
      const res = runRuleOnce(s, r, `manual-${Date.now()}`, ctx);
      return res.ok ? { ok: true as const, state: { ...res.state, recurring: res.state.recurring.map((x) => (x.id === r.id ? { ...x, runs: x.runs + 1, lastRunAt: ctx.now.toISOString() } : x)) } } : res;
    }, { success: 'Simulated payment recorded' });
  const row = (r: RecurringRule) => (
    <div key={r.id} className="row" style={{ flexWrap: 'wrap' }}>
      {r.kind === 'transfer' ? <span className="tile-ico"><CalendarClock size={20} /></span> : <CategoryGlyph category={r.category} />}
      <div className="row-main">
        <div className="row-title" style={{ color: r.active ? undefined : 'var(--text-3)' }}>
          {r.title}
        </div>
        <div className="row-sub">
          {FREQ_LABEL[r.frequency]} · {r.active ? `next ${f.day(parseDayKey(r.nextDate).toISOString())}` : 'paused'}
        </div>
      </div>
      <div className="row-end">
        <div className="row-title amount">{f.money(r.kind === 'receive' ? r.amount : -r.amount, r.currency, { sign: 'exceptZero' })}</div>
        <div className="row-sub">{r.runs} runs</div>
      </div>
      <div className="hstack" style={{ width: '100%', justifyContent: 'flex-end', gap: 2 }}>
        <button className="link-btn" onClick={() => runNow(r)}>
          Run now
        </button>
        <button className="link-btn" onClick={() => update((s) => ({ ...s, recurring: s.recurring.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)) }))}>
          {r.active ? <Pause size={13} /> : <Play size={13} />} {r.active ? 'Pause' : 'Resume'}
        </button>
        <button className="link-btn" onClick={() => open(r)}>
          Edit
        </button>
        <button
          className="link-btn"
          style={{ color: 'var(--negative)' }}
          aria-label={`Delete ${r.title}`}
          onClick={async () => {
            if (await confirm({ title: `Delete ${r.title}?`, message: 'Future occurrences stop. Past entries remain in your history.', confirmLabel: 'Delete', destructive: true })) {
              update((s) => deleteRule(s, r.id));
              toast('Schedule deleted', 'success');
            }
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
  return (
    <Page
      title="Subscriptions & schedules"
      right={
        <button className="icon-btn" aria-label="New schedule" onClick={() => open()}>
          <Plus size={22} />
        </button>
      }
    >
      {app.recurring.length === 0 ? (
        <EmptyState icon={<CalendarClock size={24} />} title="Nothing scheduled" action={<Button size="sm" onClick={() => open()}>Create a schedule</Button>}>
          Schedule simulated subscriptions, transfers, payments or income.
        </EmptyState>
      ) : (
        <>
          {monthlySubs.size > 0 && (
            <div className="panel pad" style={{ marginTop: 4 }}>
              <div className="small muted">Active subscriptions per month</div>
              {[...monthlySubs.entries()].map(([c, v]) => (
                <div key={c} className="strong amount" style={{ fontSize: 22 }}>
                  {f.money(v, c)}
                </div>
              ))}
            </div>
          )}
          {subs.length > 0 && (
            <Section title="Subscriptions">
              <div className="list">{subs.map(row)}</div>
            </Section>
          )}
          {others.length > 0 && (
            <Section title="Scheduled transfers & payments">
              <div className="list">{others.map(row)}</div>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}

/* -------------------------------- Bills ------------------------------- */

function BillSheet({ bill, close }: { bill?: BillReminder; close: () => void }) {
  const app = useApp();
  const defaultAcc = app.accounts.find((a) => a.kind === 'checking' && !a.archived)?.id ?? MAIN_ACCOUNT_ID;
  const [name, setName] = useState(bill?.name ?? '');
  const [accountId, setAccountId] = useState(bill?.accountId ?? defaultAcc);
  const acc = app.accounts.find((a) => a.id === accountId)!;
  const [text, setText] = useState(bill ? minorToKeypadText(bill.amount, CURRENCIES[bill.currency].decimals) : '');
  const [due, setDue] = useState(bill?.dueDate ?? dayKey(addDays(new Date(), 7)));
  const [repeat, setRepeat] = useState<BillReminder['repeat']>(bill?.repeat ?? 'monthly');
  const [remind, setRemind] = useState(String(bill?.remindDaysBefore ?? 3));
  const amount = amountOf(text, acc.currency);
  const input = { name, amount: amount ?? 0, currency: acc.currency, dueDate: due, repeat, accountId, remindDaysBefore: Math.max(0, Math.min(30, Number(remind) || 0)) };
  return (
    <>
      <SheetHeader title={bill ? 'Edit bill reminder' : 'New bill reminder'} onClose={close} />
      <div className="sheet-body">
        <Field label="Bill name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Volt Energy Co." maxLength={40} />
        </Field>
        <AccountSelect label="Pay from" value={accountId} onChange={setAccountId} filter={(a) => PAYMENT_KINDS.includes(a.kind)} />
        <Field label={`Amount (${acc.currency})`}>
          <TextInput value={text} onChange={setText} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Due date">
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        </Field>
        <Field label="Repeats">
          <Segmented value={repeat} onChange={setRepeat} small label="Repeat" options={[{ value: 'none', label: 'Once' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
        </Field>
        <Field label="Remind me (days before)">
          <TextInput value={remind} onChange={(v) => setRemind(v.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" />
        </Field>
      </div>
      <div className="sheet-foot">
        <Button
          block
          disabled={!name.trim() || !amount}
          onClick={() => {
            const r = bill ? act((s) => updateBill(s, bill.id, input), { success: 'Reminder saved' }) : act((s, ctx) => createBill(s, input, ctx), { success: 'Reminder created' });
            if (r.ok) close();
          }}
        >
          Save reminder
        </Button>
      </div>
    </>
  );
}

export function BillsScreen() {
  const app = useApp();
  const f = useFmt();
  const bills = [...app.bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const open = (b?: BillReminder) => openSheet((close) => <BillSheet bill={b} close={close} />, { tall: true });
  return (
    <Page
      title="Bill reminders"
      right={
        <button className="icon-btn" aria-label="New bill reminder" onClick={() => open()}>
          <Plus size={22} />
        </button>
      }
    >
      {bills.length === 0 ? (
        <EmptyState icon={<Receipt size={24} />} title="No bill reminders" action={<Button size="sm" onClick={() => open()}>Add a reminder</Button>}>
          Get in-app reminders before fictional bills are due and pay them with one tap.
        </EmptyState>
      ) : (
        <div className="list" style={{ marginTop: 4 }}>
          {bills.map((b) => {
            const days = daysBetween(new Date(), parseDayKey(b.dueDate));
            return (
              <div key={b.id} className="row" style={{ flexWrap: 'wrap' }}>
                <span className="tile-ico">
                  <Receipt size={20} />
                </span>
                <div className="row-main">
                  <div className="row-title">{b.name}</div>
                  <div className={`row-sub ${days < 0 ? 'neg' : days <= b.remindDaysBefore ? 'warn' : ''}`}>
                    {days < 0 ? `Overdue by ${-days} day${days === -1 ? '' : 's'}` : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`} · {b.repeat === 'none' ? 'once' : b.repeat}
                  </div>
                </div>
                <div className="row-end row-title amount">{f.money(b.amount, b.currency)}</div>
                <div className="hstack" style={{ width: '100%', justifyContent: 'flex-end', gap: 4, marginTop: 6 }}>
                  <button className="link-btn" onClick={() => open(b)}>
                    Edit
                  </button>
                  <button
                    className="link-btn"
                    style={{ color: 'var(--negative)' }}
                    onClick={async () => {
                      if (await confirm({ title: `Delete ${b.name}?`, message: 'Only the reminder is removed.', confirmLabel: 'Delete', destructive: true })) {
                        update((s) => deleteBill(s, b.id));
                        toast('Reminder deleted', 'success');
                      }
                    }}
                  >
                    Delete
                  </button>
                  <Button size="sm" onClick={() => act((s, ctx) => payBill(s, b.id, ctx), { success: 'Simulated bill payment recorded' })}>
                    Pay now
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="disclaimer">Reminders appear in VELTRIX’s notification center when you open the app. Paying a bill records a simulated payment in your ledger.</p>
    </Page>
  );
}

