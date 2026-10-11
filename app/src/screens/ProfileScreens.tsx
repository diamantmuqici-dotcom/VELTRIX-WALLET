import {
  ArrowDown,
  ArrowUp,
  Bell,
  Calculator,
  CalendarClock,
  ChartColumn,
  Copy,
  CreditCard,
  Database,
  Download,
  FileJson,
  Fingerprint,
  HandCoins,
  Info,
  Landmark,
  LayoutDashboard,
  Palette,
  Percent,
  Receipt,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CURRENCIES, PRIMARY_CURRENCIES } from '../domain/currency';
import { ledgerToCsv } from '../domain/csv';
import { formatMoney } from '../domain/money';
import { PAYMENT_KINDS } from '../domain/ops/common';
import { sortedCards } from '../domain/ops/entities';
import { AVATAR_COLORS, dashboardFor, defaultSettings } from '../domain/presets';
import { loadState, makeBackup } from '../domain/schema';
import type { AnimationLevel, DashboardSectionId, NumberLocale, Settings, ThemeMode } from '../domain/types';
import { validateName, validateUsername } from '../domain/validation';
import { copyText, deviceLockAvailable, isNative, openExternal, platformInfo, saveTextFile } from '../platform/bridge';
import { corruptCopy, clearCorruptCopy } from '../state/persistence';
import { replaceState, resetAll, update, useApp } from '../state/store';
import { confirm, nav, openSheet, toast } from '../state/ui';
import { ACCENT_LABEL, ACCENT_NAMES } from '../ui/tokens';
import { LogoMark } from '../ui/components/Brand';
import { Avatar } from '../ui/components/Glyphs';
import { useFmt } from '../ui/components/Money';
import { pick, pickCurrency, SheetHeader } from '../ui/components/pickers';
import { Badge, Button, Field, Notice, Page, Row, Section, Segmented, TextInput, ToggleRow } from '../ui/components/primitives';
import { openCalculator } from './CalculatorSheet';
import { backupFileName, csvFileName, rawFileName } from './fileNames';

const setSettings = (p: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...p } }));

const ico = (n: ReactNode) => <span className="tile-ico" style={{ width: 36, height: 36 }}>{n}</span>;

/* ------------------------------- Profile ------------------------------ */

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
  });
}

function ProfileSheet({ close }: { close: () => void }) {
  const app = useApp();
  const [name, setName] = useState(app.profile.displayName);
  const [username, setUsername] = useState(app.profile.username);
  const [walletId, setWalletId] = useState(app.profile.walletId);
  const [color, setColor] = useState(app.profile.avatarColor);
  const [image, setImage] = useState(app.profile.avatarImage);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameErr = validateName(name, 'Name');
  const userErr = validateUsername(username);
  const walletErr = /^[A-Z0-9][A-Z0-9-]{5,23}$/.test(walletId.toUpperCase()) ? null : 'Use 6–24 letters, digits or dashes';
  return (
    <>
      <SheetHeader title="Edit profile" onClose={close} />
      <div className="sheet-body">
        <div className="center" style={{ margin: '4px 0 14px' }}>
          <div style={{ display: 'inline-block' }}>
            <Avatar name={name || '?'} color={color} image={image} size={76} />
          </div>
          <div className="hstack" style={{ justifyContent: 'center', marginTop: 10 }}>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              Choose photo
            </Button>
            {image && (
              <Button size="sm" variant="ghost" onClick={() => setImage(null)}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setImage(await resizeImage(file));
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          />
        </div>
        <Field label="Display name" error={nameErr}>
          <TextInput value={name} onChange={setName} maxLength={40} autoCapitalize="words" />
        </Field>
        <Field label="Fictional username" error={userErr}>
          <TextInput value={username} onChange={setUsername} autoCapitalize="none" maxLength={21} />
        </Field>
        <Field label="Fictional wallet ID" error={walletErr} hint="Shown on the Receive screen. Never a real account number.">
          <TextInput value={walletId} onChange={(v) => setWalletId(v.toUpperCase())} autoCapitalize="characters" maxLength={24} />
        </Field>
        <Field label="Avatar color">
          <div className="swatches">
            {AVATAR_COLORS.map((c) => (
              <button key={c} className="swatch" aria-label={`Color ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </Field>
      </div>
      <div className="sheet-foot">
        <Button
          block
          disabled={!!(nameErr || userErr || walletErr)}
          onClick={() => {
            update((s) => ({ ...s, profile: { ...s.profile, displayName: name.trim(), username: username.replace(/^@+/, '').toLowerCase(), walletId: walletId.toUpperCase(), avatarColor: color, accent: color, avatarImage: image } }));
            toast('Profile saved', 'success');
            close();
          }}
        >
          Save profile
        </Button>
      </div>
    </>
  );
}

async function resetDemo(): Promise<void> {
  const ok = await confirm({
    title: 'Reset the demo?',
    message:
      'This permanently deletes every simulated account, card, contact, transaction, request, goal and setting stored on this device, then restarts the setup wizard.\n\nTip: export a backup first from Data & backup.',
    confirmLabel: 'Reset everything',
    destructive: true,
  });
  if (!ok) return;
  nav.resetAll();
  resetAll();
}

function SettingsList() {
  return (
    <>
      <Section title="Settings">
        <div className="list">
          <Row icon={ico(<Palette size={18} />)} title="Appearance" sub="Theme, accent, animations" onClick={() => nav.push('appearance')} chevron />
          <Row icon={ico(<LayoutDashboard size={18} />)} title="Home dashboard" sub="Sections and order" onClick={() => nav.push('dashboard')} chevron />
          <Row icon={ico(<SlidersHorizontal size={18} />)} title="Preferences" sub="Defaults, number format, balances" onClick={() => nav.push('preferences')} chevron />
          <Row icon={ico(<Percent size={18} />)} title="Simulated fees" sub="Instant send, exchange, trading" onClick={() => nav.push('fees')} chevron />
          <Row icon={ico(<Bell size={18} />)} title="Notifications" sub="In-app alerts" onClick={() => nav.push('notificationPrefs')} chevron />
          <Row icon={ico(<Fingerprint size={18} />)} title="Privacy & security" sub="App lock, hide balances" onClick={() => nav.push('security')} chevron />
          <Row icon={ico(<Database size={18} />)} title="Data & backup" sub="Export, import, reset" onClick={() => nav.push('data')} chevron />
          <Row icon={ico(<Info size={18} />)} title="About VELTRIX" onClick={() => nav.push('about')} chevron />
        </div>
      </Section>
      <div style={{ marginTop: 18 }}>
        <Button variant="danger" block icon={<RotateCcw size={18} />} onClick={() => void resetDemo()}>
          Reset demo
        </Button>
      </div>
    </>
  );
}

export function ProfileScreen() {
  const app = useApp();
  const shortcuts: Array<[string, ReactNode, () => void]> = [
    ['Accounts', <Landmark size={20} />, () => nav.push('accounts')],
    ['Cards', <CreditCard size={20} />, () => nav.push('cards')],
    ['Contacts', <Users size={20} />, () => nav.push('contacts')],
    ['Requests', <HandCoins size={20} />, () => nav.push('requests')],
    ['Analytics', <ChartColumn size={20} />, () => nav.push('analytics')],
    ['Goals', <Target size={20} />, () => nav.push('goals')],
    ['Budgets', <Wallet size={20} />, () => nav.push('budgets')],
    ['Schedules', <CalendarClock size={20} />, () => nav.push('recurring')],
    ['Bills', <Receipt size={20} />, () => nav.push('bills')],
    ['Alerts', <Bell size={20} />, () => nav.push('notifications')],
    ['Calculator', <Calculator size={20} />, () => openCalculator()],
  ];
  return (
    <>
      <header className="topbar" style={{ paddingLeft: 16 }}>
        <h1 className="page-title" style={{ margin: 0, flex: 1 }}>
          Profile
        </h1>
      </header>
      <div className="scroll">
        <div className="hero" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button style={{ border: 0, background: 'none', padding: 0 }} aria-label="Edit profile" onClick={() => openSheet((close) => <ProfileSheet close={close} />, { tall: true })}>
            <Avatar name={app.profile.displayName} color={app.profile.avatarColor} image={app.profile.avatarImage} size={64} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="strong" style={{ fontSize: 19 }}>
              {app.profile.displayName}
            </div>
            <div className="muted small">@{app.profile.username}</div>
            <button
              className="mini-chip"
              style={{ marginTop: 8 }}
              onClick={async () => toast((await copyText(app.profile.walletId)) ? 'Fictional wallet ID copied' : 'Could not copy', 'success')}
              aria-label="Copy fictional wallet ID"
            >
              {app.profile.walletId} <Copy size={12} />
            </button>
          </div>
          <Button size="sm" variant="secondary" onClick={() => openSheet((close) => <ProfileSheet close={close} />, { tall: true })}>
            Edit
          </Button>
        </div>
        <div className="qa-grid">
          {shortcuts.map(([label, icon, run]) => (
            <button key={label} className="qa" onClick={run}>
              <span className="qa-ico" style={{ width: 50, height: 50, borderRadius: 16 }}>
                {icon}
              </span>
              {label}
            </button>
          ))}
        </div>
        <SettingsList />
        <p className="disclaimer center">VELTRIX Wallet {platformInfo().appVersion} · a fictional fintech simulator. No real money, cards, accounts or credit.</p>
      </div>
    </>
  );
}

export function SettingsScreen() {
  return (
    <Page title="Settings">
      <SettingsList />
    </Page>
  );
}

/* ------------------------------ Appearance ---------------------------- */

export function AppearanceScreen() {
  const app = useApp();
  const s = app.settings;
  const theme = document.documentElement.dataset.theme ?? 'dark';
  return (
    <Page title="Appearance">
      <Section title="Theme" className="">
        <Segmented<ThemeMode>
          value={s.theme}
          onChange={(v) => setSettings({ theme: v })}
          label="Theme"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
        <p className="disclaimer">“System” follows your device setting. The status and navigation bars follow the theme too.</p>
      </Section>
      <Section title="Accent color">
        <div className="swatches">
          {ACCENT_NAMES.map((a) => (
            <button key={a} className="swatch" data-theme={theme} data-accent={a} aria-pressed={s.accent === a} aria-label={ACCENT_LABEL[a]} style={{ background: 'var(--accent)' }} onClick={() => setSettings({ accent: a })} />
          ))}
        </div>
      </Section>
      <Section title="Animation intensity">
        <Segmented<AnimationLevel>
          value={s.animation}
          onChange={(v) => setSettings({ animation: v })}
          label="Animation intensity"
          options={[
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <p className="disclaimer">Your device’s “reduce motion” setting is always respected. Animations never delay what you can do.</p>
      </Section>
      <Section title="Preview">
        <div className="panel pad">
          <div className="hstack" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="strong">Main Wallet</div>
              <div className="small muted">Simulated balance</div>
            </div>
            <Badge tone="accent">Accent</Badge>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button block>Primary action</Button>
          </div>
        </div>
      </Section>
    </Page>
  );
}

/* ------------------------------ Dashboard ----------------------------- */

const SECTION_LABEL: Record<DashboardSectionId, string> = {
  quickActions: 'Quick actions',
  accounts: 'Account tiles',
  cardPreview: 'Card preview',
  recent: 'Recent transactions',
  cashflow: 'Monthly income & spending',
  categories: 'Category breakdown',
  trend: 'Balance trend chart',
  upcoming: 'Upcoming bills & schedules',
  goals: 'Savings goals',
  contacts: 'Favorite contacts',
  currencies: 'Favorite currencies',
  cardActivity: 'Card activity',
  watchlist: 'Mini watchlist',
};

export function DashboardScreen() {
  const app = useApp();
  const list = app.settings.dashboard;
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSettings({ dashboard: next });
  };
  return (
    <Page title="Home dashboard">
      <p className="muted small" style={{ margin: '4px 4px 12px' }}>
        Choose which sections appear on Home and in what order. The balance card is always shown.
      </p>
      <div className="list">
        {list.map((s, i) => (
          <div key={s.id} className="row">
            <div className="row-main">
              <div className="row-title" style={{ color: s.visible ? undefined : 'var(--text-3)' }}>
                {SECTION_LABEL[s.id]}
              </div>
            </div>
            <button className="icon-btn" aria-label={`Move ${SECTION_LABEL[s.id]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={17} />
            </button>
            <button className="icon-btn" aria-label={`Move ${SECTION_LABEL[s.id]} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={17} />
            </button>
            <button
              role="switch"
              aria-checked={s.visible}
              aria-label={`Show ${SECTION_LABEL[s.id]}`}
              className="switch"
              onClick={() => setSettings({ dashboard: list.map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)) })}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <Button variant="secondary" block onClick={() => setSettings({ dashboard: dashboardFor(app.meta.preset) })}>
          Restore preset layout
        </Button>
      </div>
    </Page>
  );
}

/* ----------------------------- Preferences ---------------------------- */

const LOCALES: Array<[NumberLocale, string]> = [
  ['en-US', 'English (US)'],
  ['de-DE', 'German'],
  ['fr-FR', 'French'],
  ['de-CH', 'Swiss'],
  ['en-IN', 'Indian English'],
];

export function PreferencesScreen() {
  const app = useApp();
  const s = app.settings;
  const defAcc = app.accounts.find((a) => a.id === s.defaultAccountId);
  const defCard = app.cards.find((c) => c.id === s.defaultCardId);
  return (
    <Page title="Preferences">
      <Section title="Defaults" className="">
        <div className="list">
          <Row
            title="Default currency"
            sub="Used for Home summaries and analytics"
            end={s.defaultCurrency}
            onClick={async () => {
              const c = await pickCurrency(s.defaultCurrency, 'Default currency', PRIMARY_CURRENCIES.includes(s.defaultCurrency) ? undefined : undefined);
              if (c) setSettings({ defaultCurrency: c });
            }}
            chevron
          />
          <Row
            title="Default account"
            sub="Preselected when sending or receiving"
            end={defAcc?.name ?? '—'}
            onClick={async () => {
              const id = await pick(
                'Default account',
                app.accounts.filter((a) => !a.archived && PAYMENT_KINDS.includes(a.kind)).map((a) => ({ value: a.id, label: a.name, sub: a.currency })),
                s.defaultAccountId,
              );
              if (id) setSettings({ defaultAccountId: id });
            }}
            chevron
          />
          <Row
            title="Default card"
            end={defCard?.nickname ?? 'None'}
            onClick={async () => {
              const cards = sortedCards(app);
              if (!cards.length) {
                toast('Create a demo card first', 'info');
                return;
              }
              const id = await pick('Default card', cards.map((c) => ({ value: c.id, label: c.nickname, sub: `•••• ${c.displayDigits}` })), s.defaultCardId);
              if (id) setSettings({ defaultCardId: id });
            }}
            chevron
          />
        </div>
      </Section>
      <Section title="Number format">
        <div className="list">
          {LOCALES.map(([l, label]) => (
            <button key={l} className="row" onClick={() => setSettings({ numberLocale: l })}>
              <div className="row-main">
                <div className="row-title">{label}</div>
                <div className="row-sub amount">{formatMoney(123456789, 'EUR', { locale: l })}</div>
              </div>
              {s.numberLocale === l && <Badge tone="accent">Selected</Badge>}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Balances & feedback">
        <div className="list">
          <ToggleRow title="Hide balances" sub="Mask amounts on Home, accounts and the widget" checked={s.hideBalances} onChange={(v) => setSettings({ hideBalances: v })} />
          <ToggleRow
            title="Simulated activity changes balances"
            sub="When off, new payments, purchases and transfers are recorded but don’t move balances. Manual adjustments and trades always apply."
            checked={s.trackBalances}
            onChange={(v) => setSettings({ trackBalances: v })}
          />
          <ToggleRow title="Haptic feedback" sub="Gentle vibrations on taps and confirmations" checked={s.haptics} onChange={(v) => setSettings({ haptics: v })} />
          {isNative() && <ToggleRow title="Show balance in home-screen widget" sub="Off by default for privacy" checked={s.widgetShowBalance} onChange={(v) => setSettings({ widgetShowBalance: v })} />}
        </div>
      </Section>
      <Section title="Market demo">
        <div className="list">
          <ToggleRow
            title="Market simulator"
            sub="Demo prices, watchlist and practice trading"
            checked={app.markets.demoEnabled}
            onChange={(v) => update((st) => ({ ...st, markets: { ...st.markets, demoEnabled: v } }))}
          />
        </div>
      </Section>
    </Page>
  );
}

/* -------------------------------- Fees -------------------------------- */

function bpsText(bps: number): string {
  return (bps / 100).toString();
}

export function FeesScreen() {
  const app = useApp();
  const fees = app.settings.fees;
  const [instant, setInstant] = useState(bpsText(fees.instantSend.bps));
  const [exch, setExch] = useState(bpsText(fees.exchange.bps));
  const [trade, setTrade] = useState(bpsText(fees.trade.bps));
  const [tradeMin, setTradeMin] = useState((fees.trade.min / 100).toString());
  const parsePct = (t: string) => {
    const v = Number(t.replace(',', '.'));
    return Number.isFinite(v) && v >= 0 && v <= 10 ? Math.round(v * 100) : null;
  };
  const parseUsd = (t: string) => {
    const v = Number(t.replace(',', '.'));
    return Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v * 100) : null;
  };
  const vals = { instant: parsePct(instant), exch: parsePct(exch), trade: parsePct(trade), tradeMin: parseUsd(tradeMin) };
  const valid = Object.values(vals).every((v) => v !== null);
  return (
    <Page
      title="Simulated fees"
      footer={
        <Button
          block
          disabled={!valid}
          onClick={() => {
            setSettings({
              fees: {
                instantSend: { ...fees.instantSend, bps: vals.instant! },
                exchange: { ...fees.exchange, bps: vals.exch! },
                trade: { ...fees.trade, bps: vals.trade!, min: vals.tradeMin! },
              },
            });
            toast('Fees saved', 'success');
            nav.pop();
          }}
        >
          Save fees
        </Button>
      }
    >
      <Notice>Hypothetical fees used only inside the simulator. Set any of them to 0 to disable.</Notice>
      <div style={{ height: 14 }} />
      <Field label="Instant send fee (%)" hint={`Min ${formatMoney(fees.instantSend.min, 'USD').replace('$', '')} · max ${formatMoney(fees.instantSend.max, 'USD').replace('$', '')} in the account’s minor units`} error={vals.instant === null ? '0 – 10 %' : null}>
        <TextInput value={instant} onChange={setInstant} inputMode="decimal" />
      </Field>
      <Field label="Currency exchange fee (%)" error={vals.exch === null ? '0 – 10 %' : null}>
        <TextInput value={exch} onChange={setExch} inputMode="decimal" />
      </Field>
      <Field label="Trading fee (%)" error={vals.trade === null ? '0 – 10 %' : null}>
        <TextInput value={trade} onChange={setTrade} inputMode="decimal" />
      </Field>
      <Field label="Minimum trading fee (USD)" error={vals.tradeMin === null ? '0 – 1000' : null}>
        <TextInput value={tradeMin} onChange={setTradeMin} inputMode="decimal" />
      </Field>
      <Button
        variant="secondary"
        block
        onClick={() => {
          const d = defaultSettings(app.settings.defaultCurrency, app.settings.theme).fees;
          setInstant(bpsText(d.instantSend.bps));
          setExch(bpsText(d.exchange.bps));
          setTrade(bpsText(d.trade.bps));
          setTradeMin((d.trade.min / 100).toString());
        }}
      >
        Restore defaults
      </Button>
    </Page>
  );
}

/* ---------------------------- Notifications --------------------------- */

export function NotificationPrefsScreen() {
  const app = useApp();
  const n = app.settings.notifications;
  const set = (p: Partial<Settings['notifications']>) => setSettings({ notifications: { ...n, ...p } });
  return (
    <Page title="Notifications">
      <Notice>VELTRIX notifications are in-app only. The app never posts system notifications and runs no background services.</Notice>
      <div className="list" style={{ marginTop: 14 }}>
        <ToggleRow title="Payments" sub="Simulated sends, receipts and refunds" checked={n.payments} onChange={(v) => set({ payments: v })} />
        <ToggleRow title="Requests" sub="New and resolved simulated requests" checked={n.requests} onChange={(v) => set({ requests: v })} />
        <ToggleRow title="Reminders" sub="Bills and scheduled simulations" checked={n.reminders} onChange={(v) => set({ reminders: v })} />
        <ToggleRow title="Markets" sub="Filled simulated orders" checked={n.markets} onChange={(v) => set({ markets: v })} />
        <ToggleRow title="Budgets & goals" sub="Card limits, budgets and goals reached" checked={n.budgets} onChange={(v) => set({ budgets: v })} />
      </div>
    </Page>
  );
}

/* ------------------------------ Security ------------------------------ */

export function SecurityScreen() {
  const app = useApp();
  const available = deviceLockAvailable();
  return (
    <Page title="Privacy & security">
      <div className="list" style={{ marginTop: 4 }}>
        <ToggleRow
          title="App lock"
          sub={
            available
              ? 'Ask for your device PIN, pattern or biometrics when opening VELTRIX and after 30 s in the background.'
              : isNative()
                ? 'Set up a screen lock on your device to use app lock.'
                : 'Available in the Android app (uses the device screen lock).'
          }
          checked={app.settings.appLock && available}
          disabled={!available}
          onChange={(v) => setSettings({ appLock: v })}
        />
        <ToggleRow title="Hide balances" sub="Mask amounts across the app" checked={app.settings.hideBalances} onChange={(v) => setSettings({ hideBalances: v })} />
      </div>
      <Section title="What VELTRIX stores">
        <div className="panel pad small" style={{ lineHeight: 1.55 }}>
          Everything stays on this device in the app’s private storage: your fictional profile, accounts, cards (four display digits only), contacts, ledger and settings. Android backup is disabled. No analytics, ads or trackers. The only network request is the optional indicative FX-rate download you can switch on in Exchange.
        </div>
      </Section>
    </Page>
  );
}

/* -------------------------------- Data -------------------------------- */

export function DataScreen() {
  const app = useApp();
  const f = useFmt();
  const fileRef = useRef<HTMLInputElement>(null);
  const raw = corruptCopy();
  const size = new Blob([JSON.stringify(app)]).size;
  const exportCsv = async () => {
    const r = await saveTextFile(csvFileName(), 'text/csv', ledgerToCsv(app, [...app.transactions].reverse()));
    if (r.ok) toast(`Ledger exported (${app.transactions.length} simulated entries)`, 'success');
    else if (r.message !== 'canceled') toast('Export failed', 'error');
  };
  const exportBackup = async () => {
    const r = await saveTextFile(backupFileName(), 'application/json', makeBackup(app, new Date()));
    if (r.ok) toast('Backup saved', 'success');
    else if (r.message !== 'canceled') toast('Backup failed', 'error');
  };
  const onImport = async (file: File) => {
    if (file.size > 25_000_000) {
      toast('That file is too large to be a VELTRIX backup', 'error');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON', 'error');
      return;
    }
    const r = loadState(json);
    if (!r.ok) {
      openSheet((close) => (
        <>
          <SheetHeader title="Backup rejected" onClose={close} />
          <div className="sheet-body">
            <Notice tone="error">Nothing was changed. The file failed validation:</Notice>
            <ul className="small" style={{ lineHeight: 1.6 }}>
              {r.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        </>
      ));
      return;
    }
    const ok = await confirm({
      title: 'Replace all data with this backup?',
      message: `The backup contains ${f.num(r.state.accounts.length)} accounts, ${f.num(r.state.cards.length)} cards and ${f.num(r.state.transactions.length)} ledger entries. Everything currently in VELTRIX on this device will be replaced.${r.warnings.length ? `\n\nNote: ${r.warnings.join(' ')}` : ''}`,
      confirmLabel: 'Replace',
      destructive: true,
    });
    if (!ok) return;
    replaceState(r.state);
    nav.resetAll();
    toast('Backup restored', 'success');
  };
  return (
    <Page title="Data & backup">
      <div className="panel pad small" style={{ marginTop: 4 }}>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Ledger entries</span>
          <span className="strong">{f.num(app.transactions.length)}</span>
        </div>
        <div className="hstack" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <span className="muted">Stored on this device</span>
          <span className="strong">{f.num(size / 1024, 0, 0)} KB</span>
        </div>
      </div>
      <Section title="Export">
        <div className="list">
          <Row icon={ico(<Download size={18} />)} title="Export ledger (CSV)" sub="Every row is marked SIMULATED" onClick={exportCsv} chevron />
          <Row icon={ico(<FileJson size={18} />)} title="Save full backup (JSON)" sub="Restore it later on this or another device" onClick={exportBackup} chevron />
        </div>
      </Section>
      <Section title="Import">
        <div className="list">
          <Row icon={ico(<Upload size={18} />)} title="Restore from backup" sub="Validated before anything is replaced" onClick={() => fileRef.current?.click()} chevron />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void onImport(file);
          }}
        />
      </Section>
      {raw && (
        <Section title="Recovered data">
          <Notice tone="warn">A saved file could not be read earlier. You can export the raw file for inspection, or discard it.</Notice>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <Button variant="secondary" size="sm" onClick={() => void saveTextFile(rawFileName(), 'application/json', raw)}>
              Export raw file
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                clearCorruptCopy();
                toast('Discarded', 'success');
                nav.pop();
              }}
            >
              Discard
            </Button>
          </div>
        </Section>
      )}
      <Section title="Reset">
        <Button variant="danger" block icon={<RotateCcw size={18} />} onClick={() => void resetDemo()}>
          Reset demo
        </Button>
        <p className="disclaimer">Reset deletes all simulator data stored by VELTRIX on this device and returns to setup. It cannot be undone unless you saved a backup.</p>
      </Section>
    </Page>
  );
}

/* -------------------------------- About ------------------------------- */

export function AboutScreen() {
  const info = platformInfo();
  return (
    <Page title="About">
      <div className="center" style={{ margin: '10px 0 18px' }}>
        <div style={{ display: 'inline-block' }}>
          <LogoMark size={72} />
        </div>
        <h2 style={{ margin: '12px 0 2px', letterSpacing: '0.2em' }}>VELTRIX</h2>
        <div className="muted">Your Money. Your Universe.</div>
        <div className="faint small" style={{ marginTop: 6 }}>
          Version {info.appVersion} · {info.platform === 'android' ? `Android API ${info.sdk}` : 'Web preview'}
        </div>
      </div>
      <Notice tone="warn">
        VELTRIX is a <b>simulator</b>. Every balance, transfer, card, account, credit figure and trade is fictional. It does not connect to banks, card networks, brokers or payment providers, and it cannot move real money.
      </Notice>
      <Section title="Data sources">
        <div className="panel pad small" style={{ lineHeight: 1.55 }}>
          Market prices come from VELTRIX’s deterministic demo engine and are labelled “demo”. FX rates are bundled sample values unless you enable live indicative rates, which are provided by ExchangeRate-API (open access) and may differ from real provider rates.
          <div style={{ marginTop: 8 }}>
            <button className="link-btn" style={{ paddingLeft: 0 }} onClick={() => openExternal('https://www.exchangerate-api.com')}>
              Rates by ExchangeRate-API
            </button>
          </div>
        </div>
      </Section>
      <Section title="Open-source software">
        <div className="panel pad small" style={{ lineHeight: 1.7 }}>
          React (MIT) · lucide icons (ISC) · big.js (MIT) · qrcode-generator (MIT) · Inter typeface by Rasmus Andersson (SIL Open Font License 1.1)
        </div>
      </Section>
      <Section title="Trademarks">
        <div className="panel pad small" style={{ lineHeight: 1.55 }}>
          VELTRIX uses only original designs. Card network marks in the card studio are fictional. Company and index names in the market simulator are used for illustration only. QR Code is a registered trademark of DENSO WAVE INCORPORATED.
        </div>
      </Section>
      <p className="disclaimer center">{CURRENCIES.USD ? 'Made for demonstration, design and education.' : ''}</p>
    </Page>
  );
}
