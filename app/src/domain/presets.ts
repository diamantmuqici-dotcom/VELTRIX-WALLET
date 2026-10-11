import Big from 'big.js';
import { CURRENCIES, type CurrencyCode } from './currency';
import { addDays, addMonths, dayKey, startOfDay } from './dates';
import { DEMO_RATES, crossRate } from './fx';
import { makeId, makeWalletId } from './ids';
import { postTxn, pushNotification, rebuildSnapshots } from './ledger';
import { ASSET_MAP, DEFAULT_WATCHLIST, demoQuote, executeTrade } from './markets';
import { pow10 } from './money';
import { MAIN_ACCOUNT_ID, newTxn } from './ops/common';
import { createAccount, createCard, createContact, type CardInput } from './ops/entities';
import { createRequest, exchange, purchase, receiveMoney, resolveRequest, reverseTxn, sendMoney, transfer } from './ops/payments';
import { createBill, createGoal, createRule, moveGoalFunds, setBudget } from './ops/planning';
import {
  SCHEMA_VERSION,
  type AccentName,
  type AccountIcon,
  type AccountKind,
  type AppState,
  type CardKind,
  type CardNetwork,
  type CardPattern,
  type CardStyle,
  type Category,
  type DashboardSectionId,
  type OpContext,
  type OpResult,
  type PresetId,
  type Settings,
  type ThemeMode,
} from './types';
import { cleanText } from './validation';

/* ------------------------------------------------------------------ */
/* Static catalogue                                                    */
/* ------------------------------------------------------------------ */

export interface PresetInfo {
  id: PresetId;
  name: string;
  description: string;
  highlights: string[];
  /** Default main-wallet balance in USD-equivalent major units. */
  mainUsd: number;
}

export const PRESETS: PresetInfo[] = [
  { id: 'minimal', name: 'Minimal', description: 'One wallet, one demo card and a short history.', highlights: ['Main wallet', '1 demo card', 'A few sample entries'], mainUsd: 2500 },
  {
    id: 'everyday',
    name: 'Everyday Banking',
    description: 'Checking, savings, a simulated credit line and three months of everyday activity.',
    highlights: ['6 accounts + credit', '3 demo cards', 'Goals, budgets & bills'],
    mainUsd: 4820.75,
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Higher simulated balances, multi-currency wallets, metal-style cards and a small portfolio.',
    highlights: ['Multi-currency', '4 demo cards', 'Portfolio included'],
    mainUsd: 48250,
  },
  {
    id: 'investor',
    name: 'Investor Demo',
    description: 'A diversified simulated portfolio with order history and realized gains.',
    highlights: ['12+ positions', 'Order history', 'Watchlist'],
    mainUsd: 12000,
  },
  { id: 'sandbox', name: 'Empty Sandbox', description: 'A clean slate: one wallet and nothing else. Build everything yourself.', highlights: ['Main wallet only', 'No history'], mainUsd: 0 },
];

export const ACCOUNT_COLORS = ['#2DD4A7', '#7C6CF2', '#3B82F6', '#F5A524', '#F45B69', '#10B981', '#64748B', '#E879F9', '#22D3EE', '#A3E635'];
export const AVATAR_COLORS = ['#7C6CF2', '#2DD4A7', '#F5A524', '#3B82F6', '#F45B69', '#10B981', '#E879F9', '#22D3EE'];

export const DASHBOARD_ORDER: DashboardSectionId[] = [
  'quickActions',
  'accounts',
  'cardPreview',
  'recent',
  'cashflow',
  'categories',
  'trend',
  'upcoming',
  'goals',
  'contacts',
  'currencies',
  'cardActivity',
  'watchlist',
];

const DASHBOARD_VISIBLE: Record<PresetId, DashboardSectionId[]> = {
  minimal: ['quickActions', 'accounts', 'cardPreview', 'recent', 'cashflow'],
  everyday: ['quickActions', 'accounts', 'cardPreview', 'recent', 'cashflow', 'categories', 'trend', 'upcoming', 'goals', 'contacts', 'currencies'],
  premium: DASHBOARD_ORDER,
  investor: ['quickActions', 'accounts', 'watchlist', 'recent', 'cashflow', 'trend', 'currencies'],
  sandbox: ['quickActions', 'accounts', 'cardPreview', 'recent'],
};

export function dashboardFor(preset: PresetId): Settings['dashboard'] {
  const visible = new Set(DASHBOARD_VISIBLE[preset]);
  return DASHBOARD_ORDER.map((id) => ({ id, visible: visible.has(id) }));
}

export function defaultSettings(currency: CurrencyCode, theme: ThemeMode, accent: AccentName = 'mint', preset: PresetId = 'everyday'): Settings {
  return {
    theme,
    accent,
    defaultCurrency: currency,
    defaultAccountId: MAIN_ACCOUNT_ID,
    defaultCardId: '',
    numberLocale: 'en-US',
    hideBalances: false,
    haptics: true,
    animation: 'full',
    notifications: { payments: true, requests: true, reminders: true, markets: true, budgets: true },
    trackBalances: true,
    fees: {
      instantSend: { bps: 150, fixed: 0, min: 25, max: 1500 },
      exchange: { bps: 50, fixed: 0, min: 0, max: 0 },
      trade: { bps: 10, fixed: 0, min: 100, max: 0 },
    },
    dashboard: dashboardFor(preset),
    foreignWalletName: 'FX Wallet',
    liveRates: false,
    appLock: false,
    widgetShowBalance: false,
  };
}

export function usernameFrom(name: string): string {
  const base = cleanText(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 20)
    .replace(/\.+$/g, '');
  return base.length >= 3 ? base : 'veltrix.user';
}

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function usdTo(cur: CurrencyCode): Big {
  return new Big(DEMO_RATES.rates[cur] ?? '1');
}

/** USD-equivalent major units → local minor units, rounded to a natural-looking amount. */
export function localNice(usd: number, cur: CurrencyCode): number {
  const dec = CURRENCIES[cur].decimals;
  const m = Number(usdTo(cur).times(usd).toString());
  const step = m >= 10000 ? 100 : m >= 1000 ? 10 : m >= 200 ? 5 : m >= 20 ? 1 : dec === 0 ? 1 : 0.5;
  const v = Math.round(m / step) * step;
  return Math.round(v * pow10(dec));
}

/** Price-style amount (…99) for subscriptions. */
export function localPrice(usd: number, cur: CurrencyCode): number {
  const dec = CURRENCIES[cur].decimals;
  const m = Number(usdTo(cur).times(usd).toString());
  if (dec === 0) return Math.max(10, Math.round(m / 10) * 10);
  return Math.round((Math.floor(m) + 0.99) * pow10(dec));
}

/** USD-equivalent → local minor units, keeping cents (used for balances). */
export function localBalance(usd: number, cur: CurrencyCode): number {
  const dec = CURRENCIES[cur].decimals;
  return Math.round(Number(usdTo(cur).times(usd).toString()) * pow10(dec));
}

function localExact(usd: number, cur: CurrencyCode): number {
  const dec = CURRENCIES[cur].decimals;
  return Math.max(1, Math.round(Number(usdTo(cur).times(usd).toString()) * pow10(dec)));
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

export interface SetupOptions {
  preset: PresetId;
  displayName: string;
  username?: string;
  currency: CurrencyCode;
  theme: ThemeMode;
  accent?: AccentName;
  /** Main wallet balance in minor units; null → preset default. */
  startingBalance: number | null;
  cardStyle: CardStyle;
  sampleTransactions: boolean;
  marketDemo: boolean;
  liveRates?: boolean;
  now: Date;
  seed?: number;
  id?: (prefix: string) => string;
  walletId?: string;
}

export function baseState(opts: SetupOptions): AppState {
  const name = cleanText(opts.displayName) || 'Alex Morgan';
  const nowIso = opts.now.toISOString();
  const settings = defaultSettings(opts.currency, opts.theme, opts.accent ?? 'mint', opts.preset);
  settings.liveRates = !!opts.liveRates;
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: nowIso, onboarded: true, preset: opts.preset, lastOpenedAt: nowIso, processedOps: [] },
    profile: {
      displayName: name,
      username: opts.username ? opts.username.replace(/^@+/, '').toLowerCase() : usernameFrom(name),
      walletId: opts.walletId ?? makeWalletId(),
      avatarColor: AVATAR_COLORS[0],
      avatarImage: null,
      accent: AVATAR_COLORS[0],
    },
    settings,
    accounts: [],
    cards: [],
    contacts: [],
    transactions: [],
    requests: [],
    markets: { watchlist: [...DEFAULT_WATCHLIST], positions: {}, orders: [], realizedPnl: 0, demoEnabled: opts.marketDemo },
    fx: { favorites: [], lookups: [], liveCache: null },
    goals: [],
    budgets: [],
    recurring: [],
    bills: [],
    notifications: [],
  };
}

interface AccountSpec {
  id: string;
  kind: AccountKind;
  name: string;
  currency: CurrencyCode;
  /** final balance in minor units (credit: negative = used) */
  target: number;
  color: string;
  icon?: AccountIcon;
  show: boolean;
  credit?: { limit: number; statement: number; dueInDays: number };
}

interface CardSpec {
  style: CardStyle;
  nickname: string;
  kind: CardKind;
  accountId: string;
  pattern: CardPattern;
  network: CardNetwork;
  accent: string;
  limitUsd: number;
}

function fxCurrencies(main: CurrencyCode, n: number): CurrencyCode[] {
  const order: CurrencyCode[] = main === 'USD' ? ['EUR', 'GBP', 'CHF', 'JPY'] : ['USD', 'EUR', 'GBP', 'CHF', 'JPY'];
  return order.filter((c) => c !== main).slice(0, n);
}

function altStyle(chosen: CardStyle, wanted: CardStyle, fallback: CardStyle): CardStyle {
  return chosen === wanted ? fallback : wanted;
}

function accountsFor(opts: SetupOptions): AccountSpec[] {
  const cur = opts.currency;
  const info = PRESETS.find((p) => p.id === opts.preset) as PresetInfo;
  const main = opts.startingBalance ?? localBalance(info.mainUsd, cur);
  const inv = (usd: number): AccountSpec => ({ id: 'acc_invest', kind: 'investment', name: 'Investment', currency: 'USD', target: Math.round(usd * 100), color: ACCOUNT_COLORS[5], show: true });
  const list: AccountSpec[] = [{ id: MAIN_ACCOUNT_ID, kind: 'wallet', name: 'Main Wallet', currency: cur, target: main, color: ACCOUNT_COLORS[0], show: true }];
  switch (opts.preset) {
    case 'minimal':
      list.push({ ...inv(0), show: false });
      break;
    case 'sandbox':
      list.push({ ...inv(0), show: false });
      break;
    case 'everyday': {
      const [fx1] = fxCurrencies(cur, 1);
      list.push(
        { id: 'acc_checking', kind: 'checking', name: 'Checking', currency: cur, target: localNice(2310.4, cur) + 40, color: ACCOUNT_COLORS[2], show: true },
        { id: 'acc_savings', kind: 'savings', name: 'Savings', currency: cur, target: localNice(9400, cur), color: ACCOUNT_COLORS[3], show: true },
        { id: 'acc_card', kind: 'card', name: 'Virtual Card', currency: cur, target: localNice(180, cur), color: ACCOUNT_COLORS[1], show: true },
        inv(1250),
        { id: 'acc_fx1', kind: 'foreign', name: `${fx1} Wallet`, currency: fx1, target: localNice(640, fx1), color: ACCOUNT_COLORS[8], show: true },
        {
          id: 'acc_credit',
          kind: 'credit',
          name: 'Credit Line (simulated)',
          currency: cur,
          target: -localNice(1240, cur),
          color: ACCOUNT_COLORS[4],
          show: true,
          credit: { limit: localNice(5000, cur), statement: localNice(980, cur), dueInDays: 18 },
        },
      );
      break;
    }
    case 'premium': {
      const fx = fxCurrencies(cur, 3);
      list.push(
        { id: 'acc_checking', kind: 'checking', name: 'Private Checking', currency: cur, target: localNice(18400, cur), color: ACCOUNT_COLORS[2], show: true },
        { id: 'acc_savings', kind: 'savings', name: 'Reserve Savings', currency: cur, target: localNice(126000, cur), color: ACCOUNT_COLORS[3], show: true },
        { id: 'acc_card', kind: 'card', name: 'Virtual Card', currency: cur, target: localNice(1500, cur), color: ACCOUNT_COLORS[1], show: true },
        inv(8400),
        ...fx.map((c, i) => ({ id: `acc_fx${i + 1}`, kind: 'foreign' as const, name: `${c} Wallet`, currency: c, target: localNice([6200, 3100, 2400][i], c), color: ACCOUNT_COLORS[[8, 7, 9][i]], show: true })),
        {
          id: 'acc_credit',
          kind: 'credit',
          name: 'Reserve Credit (simulated)',
          currency: cur,
          target: -localNice(3860, cur),
          color: ACCOUNT_COLORS[4],
          show: true,
          credit: { limit: localNice(25000, cur), statement: localNice(2950, cur), dueInDays: 12 },
        },
      );
      break;
    }
    case 'investor': {
      const [fx1] = fxCurrencies(cur, 1);
      list.push(
        { id: 'acc_checking', kind: 'checking', name: 'Checking', currency: cur, target: localNice(5600, cur), color: ACCOUNT_COLORS[2], show: true },
        inv(14250),
        { id: 'acc_fx1', kind: 'foreign', name: `${fx1} Wallet`, currency: fx1, target: localNice(1800, fx1), color: ACCOUNT_COLORS[8], show: true },
      );
      break;
    }
  }
  return list;
}

function cardsFor(opts: SetupOptions): CardSpec[] {
  const s = opts.cardStyle;
  switch (opts.preset) {
    case 'minimal':
    case 'sandbox':
      return [{ style: s, nickname: 'Everyday', kind: 'debit', accountId: MAIN_ACCOUNT_ID, pattern: 'lines', network: 'vx', accent: '#2DD4A7', limitUsd: 2500 }];
    case 'everyday':
      return [
        { style: s, nickname: 'Everyday', kind: 'debit', accountId: MAIN_ACCOUNT_ID, pattern: 'lines', network: 'vx', accent: '#2DD4A7', limitUsd: 3000 },
        { style: altStyle(s, 'glacier', 'aurora'), nickname: 'Online', kind: 'prepaid', accountId: 'acc_card', pattern: 'waves', network: 'orbit', accent: '#7C6CF2', limitUsd: 600 },
        { style: altStyle(s, 'royal', 'midnight'), nickname: 'Travel Credit', kind: 'credit', accountId: 'acc_credit', pattern: 'topo', network: 'nexa', accent: '#F5A524', limitUsd: 0 },
      ];
    case 'premium':
      return [
        { style: s, nickname: 'Signature', kind: 'debit', accountId: MAIN_ACCOUNT_ID, pattern: 'mesh', network: 'vx', accent: '#E5C07B', limitUsd: 20000 },
        { style: altStyle(s, 'royal', 'obsidian'), nickname: 'Reserve Credit', kind: 'credit', accountId: 'acc_credit', pattern: 'topo', network: 'nexa', accent: '#F5A524', limitUsd: 0 },
        { style: altStyle(s, 'pearl', 'glacier'), nickname: 'Household', kind: 'debit', accountId: 'acc_checking', pattern: 'dots', network: 'orbit', accent: '#3B82F6', limitUsd: 8000 },
        { style: altStyle(s, 'aurora', 'neon'), nickname: 'Virtual', kind: 'prepaid', accountId: 'acc_card', pattern: 'waves', network: 'neutral', accent: '#E879F9', limitUsd: 2000 },
      ];
    case 'investor':
      return [
        { style: s, nickname: 'Everyday', kind: 'debit', accountId: MAIN_ACCOUNT_ID, pattern: 'grid', network: 'vx', accent: '#2DD4A7', limitUsd: 4000 },
        { style: altStyle(s, 'carbon', 'obsidian'), nickname: 'Bills', kind: 'debit', accountId: 'acc_checking', pattern: 'lines', network: 'orbit', accent: '#64748B', limitUsd: 2000 },
      ];
  }
}

const CONTACTS = [
  { name: 'Ava Laurent', username: 'ava.laurent', identifier: 'ava@example.com', note: 'Book club' },
  { name: 'Noah Kim', username: 'noahk', identifier: '', note: 'Roommate' },
  { name: 'Mila Hoxha', username: 'mila.hoxha', identifier: '+355 69 000 0000', note: 'Tirana trip' },
  { name: 'Lucas Ferreira', username: 'lucasf', identifier: '', note: '' },
  { name: 'Zara Okafor', username: 'zara.o', identifier: 'zara@example.org', note: 'Climbing partner' },
  { name: 'Elif Demir', username: 'elifd', identifier: '', note: 'Istanbul office' },
  { name: 'Theo Brandt', username: 'theob', identifier: '', note: '' },
  { name: 'Sofia Rossi', username: 'sofiar', identifier: 'sofia@example.net', note: 'Neighbor' },
];

const CONTACT_COUNT: Record<PresetId, number> = { minimal: 3, everyday: 6, premium: 8, investor: 4, sandbox: 0 };

const EMPLOYER = { name: 'Brightline Studio (fictional employer)' };
const P2P_IN_NOTES = ['Dinner split', 'Thanks for the tickets', 'Groceries share', 'Cab home', 'Brunch', 'Gift pool'];
const P2P_OUT_NOTES = ['Birthday gift', 'Concert tickets', 'Your half of rent supplies', 'Coffee run', 'Movie night', 'Thanks for the ride'];

interface Ctx {
  state: AppState;
  rng: () => number;
  id: (p: string) => string;
  cur: CurrencyCode;
  now: Date;
  scale: number;
}

type Step = (s: AppState, c: OpContext) => AppState;

interface Event {
  at: Date;
  run: Step;
}

function keep(r: OpResult<object>, s: AppState): AppState {
  return r.ok ? r.state : s;
}

function between(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

function pick<T>(rng: () => number, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function at(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const d = startOfDay(addDays(now, -daysAgo));
  d.setHours(hour, minute, 0, 0);
  return d;
}

function hasAccount(s: AppState, id: string): boolean {
  return s.accounts.some((a) => a.id === id);
}

function cardOn(s: AppState, accountId: string): string | undefined {
  return s.cards.find((c) => c.accountId === accountId)?.id;
}

function contactParty(s: AppState, rng: () => number) {
  if (s.contacts.length === 0) return { name: 'Jordan Vale' };
  const c = pick(rng, s.contacts);
  return { contactId: c.id, name: c.name, handle: c.username };
}

const GROCERS = ['Green Basket Market', 'FreshLane Grocers', 'Corner Pantry'];
const DINING = ['Sushi Ito', 'Trattoria Sole', 'Bao House', 'Lantern Kitchen'];
const SHOPS = ['Urban Threads', 'Pixel Plaza Electronics', 'Bookshelf Corner', 'Nordlight Home'];

function buy(c: Ctx, cardAccount: string, merchant: string, usd: number, category: Category, note?: string): Step {
  return (s, ctx) => {
    const cardId = cardOn(s, cardAccount) ?? cardOn(s, MAIN_ACCOUNT_ID);
    if (!cardId) return s;
    return keep(purchase(s, { cardId, merchant, amount: localExact(usd * c.scale, c.cur), category, note }, ctx), s);
  };
}

function everydayEvents(c: Ctx, withCredit: boolean): Event[] {
  const ev: Event[] = [];
  const { rng, now, cur } = c;
  const salaryAcc = hasAccount(c.state, 'acc_checking') ? 'acc_checking' : MAIN_ACCOUNT_ID;
  const fx1 = c.state.accounts.find((a) => a.id === 'acc_fx1');
  const onlineAcc = hasAccount(c.state, 'acc_card') ? 'acc_card' : MAIN_ACCOUNT_ID;
  const creditAcc = withCredit && hasAccount(c.state, 'acc_credit') ? 'acc_credit' : MAIN_ACCOUNT_ID;
  // Monthly anchors for the last four months.
  for (let m = 3; m >= 0; m--) {
    const month = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -m);
    const day = (d: number, h: number, min = 0) => {
      const x = new Date(month.getFullYear(), month.getMonth(), d, h, min);
      return x;
    };
    ev.push({ at: day(1, 9, 5), run: (s, ctx) => keep(receiveMoney(s, { from: EMPLOYER, amount: localNice(4200 * c.scale, cur), accountId: salaryAcc, note: 'Monthly salary (simulated)', category: 'income' }, ctx), s) });
    if (salaryAcc !== MAIN_ACCOUNT_ID) {
      ev.push({ at: day(2, 8, 30), run: (s, ctx) => keep(transfer(s, { fromId: salaryAcc, toId: MAIN_ACCOUNT_ID, amount: localNice(1100 * c.scale, cur), note: 'Spending money' }, ctx), s) });
    }
    ev.push({ at: day(3, 10, 12), run: (s, ctx) => keep(sendMoney(s, { recipient: { name: 'Harbor Lane Rentals' }, amount: localNice(1450 * c.scale, cur), accountId: salaryAcc, note: 'Monthly rent', category: 'bills' }, ctx), s) });
    ev.push({
      at: day(5, 7, 45),
      run: (s, ctx) => {
        const goal = s.goals[0];
        if (!goal || !hasAccount(s, goal.accountId)) return s;
        return keep(moveGoalFunds(s, { goalId: goal.id, otherAccountId: salaryAcc, amount: localNice(350 * c.scale, cur), direction: 'contribute' }, ctx), s);
      },
    });
    ev.push({ at: day(8, 18, 20), run: (s, ctx) => keep(sendMoney(s, { recipient: { name: 'Volt Energy Co.' }, amount: localExact(between(rng, 72, 118) * c.scale, cur), accountId: salaryAcc, note: 'Electricity', category: 'bills' }, ctx), s) });
    ev.push({ at: day(12, 9, 0), run: (s, ctx) => keep(sendMoney(s, { recipient: { name: 'FiberNet Home' }, amount: localPrice(49.99, cur), accountId: salaryAcc, note: 'Home internet', category: 'bills' }, ctx), s) });
    ev.push({ at: day(14, 6, 0), run: subscription(onlineAcc, 'StreamBox', localPrice(15.99, cur), 'rule_streambox') });
    ev.push({ at: day(14, 6, 2), run: subscription(onlineAcc, 'CloudVault', localPrice(2.99, cur), 'rule_cloudvault') });
    ev.push({ at: day(20, 6, 0), run: subscription(MAIN_ACCOUNT_ID, 'FitForge Gym', localNice(39 * c.scale, cur), 'rule_gym') });
    if (fx1) {
      ev.push({
        at: day(16, 12, 40),
        run: (s, ctx) => {
          const rate = crossRate(DEMO_RATES, cur, fx1.currency);
          return keep(exchange(s, { fromId: MAIN_ACCOUNT_ID, toId: fx1.id, amount: localNice(250 * c.scale, cur), rate, rateSource: 'demo', rateTimestamp: DEMO_RATES.publishedAt }, ctx), s);
        },
      });
    }
    if (creditAcc === 'acc_credit') {
      ev.push({
        at: day(25, 19, 10),
        run: (s, ctx) => {
          const credit = s.accounts.find((a) => a.id === 'acc_credit');
          if (!credit || credit.balance >= 0) return s;
          const amount = Math.min(-credit.balance, localNice(300 * c.scale, cur));
          return keep(transfer(s, { fromId: salaryAcc, toId: 'acc_credit', amount, note: 'Card repayment' }, ctx), s);
        },
      });
    }
  }
  // Day-to-day activity.
  let nextGrocery = 95;
  for (let d = 95; d >= 0; d--) {
    if (d === nextGrocery) {
      ev.push({ at: at(now, d, 17, Math.floor(rng() * 50)), run: buy(c, MAIN_ACCOUNT_ID, pick(rng, GROCERS), between(rng, 28, 115), 'food') });
      nextGrocery = d - 3 - Math.floor(rng() * 3);
    }
    if (rng() < 0.35) ev.push({ at: at(now, d, 8, Math.floor(rng() * 55)), run: buy(c, MAIN_ACCOUNT_ID, 'Bean & Bloom Café', between(rng, 3.2, 6.8), 'food') });
    if (rng() < 0.25) ev.push({ at: at(now, d, 7, 30 + Math.floor(rng() * 25)), run: buy(c, MAIN_ACCOUNT_ID, 'Metro Transit', between(rng, 2.9, 18), 'transport') });
    if (rng() < 0.17) ev.push({ at: at(now, d, 20, Math.floor(rng() * 50)), run: buy(c, MAIN_ACCOUNT_ID, pick(rng, DINING), between(rng, 18, 72), 'food') });
    if (rng() < 0.08) ev.push({ at: at(now, d, 15, Math.floor(rng() * 50)), run: buy(c, creditAcc, pick(rng, SHOPS), between(rng, 25, 190), 'shopping') });
    if (rng() < 0.05) ev.push({ at: at(now, d, 21, 10), run: buy(c, onlineAcc, 'Lumen Cinema', between(rng, 12, 32), 'entertainment') });
    if (rng() < 0.03) ev.push({ at: at(now, d, 11, 25), run: buy(c, MAIN_ACCOUNT_ID, 'Cedar Pharmacy', between(rng, 8, 45), 'health') });
    if (rng() < 0.06) {
      const usd = between(rng, 15, 60);
      const note = pick(rng, P2P_IN_NOTES);
      ev.push({ at: at(now, d, 13, Math.floor(rng() * 59)), run: (s, ctx) => keep(receiveMoney(s, { from: contactParty(s, rng), amount: localExact(usd * c.scale, cur), accountId: MAIN_ACCOUNT_ID, note }, ctx), s) });
    }
    if (rng() < 0.06) {
      const usd = between(rng, 12, 80);
      const note = pick(rng, P2P_OUT_NOTES);
      ev.push({ at: at(now, d, 19, Math.floor(rng() * 59)), run: (s, ctx) => keep(sendMoney(s, { recipient: contactParty(s, rng), amount: localExact(usd * c.scale, cur), accountId: MAIN_ACCOUNT_ID, note }, ctx), s) });
    }
  }
  // Specials.
  ev.push({ at: at(now, 41, 6, 15), run: buy(c, creditAcc, 'Atlas Air (demo)', 320, 'travel', 'Weekend flight') });
  ev.push({ at: at(now, 41, 6, 20), run: buy(c, creditAcc, 'Seabreeze Hotel', 410, 'travel') });
  ev.push({ at: at(now, 20, 14, 5), run: buy(c, MAIN_ACCOUNT_ID, 'Urban Threads', 89, 'shopping', 'Jacket — returned') });
  ev.push({
    at: at(now, 17, 10, 0),
    run: (s, ctx) => {
      const t = [...s.transactions].reverse().find((x) => x.title === 'Urban Threads' && x.note === 'Jacket — returned');
      return t ? keep(reverseTxn(s, t.id, ctx), s) : s;
    },
  });
  ev.push({ at: at(now, 9, 12, 30), run: (s, ctx) => keep(sendMoney(s, { recipient: contactParty(s, rng), amount: localNice(120 * c.scale, cur), accountId: MAIN_ACCOUNT_ID, note: 'Festival pass', instant: true }, ctx), s) });
  ev.push({
    at: at(now, 12, 18, 0),
    run: (s, ctx) => {
      const r = createRequest(s, { party: contactParty(s, rng), amount: localNice(18, cur), accountId: MAIN_ACCOUNT_ID, note: 'Lunch' }, ctx);
      return r.ok ? keep(resolveRequest(r.state, r.request.id, 'accept', { ...ctx, now: new Date(ctx.now.getTime() + 5 * 3600_000) }), r.state) : s;
    },
  });
  ev.push({ at: at(now, 2, 16, 40), run: (s, ctx) => keep(createRequest(s, { party: contactParty(s, rng), amount: localNice(35, cur), accountId: MAIN_ACCOUNT_ID, note: 'Shared gift', direction: 'incoming' }, ctx), s) });
  ev.push({ at: at(now, 1, 21, 5), run: (s, ctx) => keep(createRequest(s, { party: contactParty(s, rng), amount: localNice(24, cur), accountId: MAIN_ACCOUNT_ID, note: 'Pizza night' }, ctx), s) });
  ev.push({ at: new Date(now.getTime() - 3 * 3600_000), run: (s, ctx) => keep(sendMoney(s, { recipient: contactParty(s, rng), amount: localNice(45, cur), accountId: MAIN_ACCOUNT_ID, note: 'Concert tickets', outcome: 'pending' }, ctx), s) });
  return ev;
}

function subscription(accountId: string, merchant: string, amount: number, ruleId: string): Step {
  return (s, ctx) => {
    const cardId = cardOn(s, accountId) ?? cardOn(s, MAIN_ACCOUNT_ID);
    if (!cardId) return s;
    const r = purchase(s, { cardId, merchant, amount, category: 'subscriptions', subtype: 'subscription' }, ctx);
    if (!r.ok) return s;
    const realRule = s.recurring.find((x) => x.title === merchant)?.id ?? ruleId;
    return { ...r.state, transactions: r.state.transactions.map((t) => (t.id === r.txn.id ? { ...t, links: { ...t.links, ruleId: realRule } } : t)) };
  };
}

function lightEvents(c: Ctx): Event[] {
  const { now, cur, rng } = c;
  const ev: Event[] = [];
  ev.push({ at: at(now, 26, 9, 10), run: (s, ctx) => keep(receiveMoney(s, { from: EMPLOYER, amount: localNice(1800, cur), accountId: MAIN_ACCOUNT_ID, note: 'Freelance invoice (simulated)', category: 'income' }, ctx), s) });
  const spends: Array<[number, string, number, Category]> = [
    [24, 'Green Basket Market', 64.2, 'food'],
    [19, 'Metro Transit', 32, 'transport'],
    [15, 'Bean & Bloom Café', 5.4, 'food'],
    [11, 'Bookshelf Corner', 23.9, 'shopping'],
    [6, 'Green Basket Market', 48.75, 'food'],
    [2, 'Lumen Cinema', 14.5, 'entertainment'],
  ];
  for (const [d, merchant, usd, cat] of spends) ev.push({ at: at(now, d, 12 + Math.floor(rng() * 8), Math.floor(rng() * 59)), run: buy(c, MAIN_ACCOUNT_ID, merchant, usd, cat) });
  ev.push({ at: at(now, 8, 19, 30), run: (s, ctx) => keep(sendMoney(s, { recipient: contactParty(s, rng), amount: localNice(40, cur), accountId: MAIN_ACCOUNT_ID, note: 'Dinner' }, ctx), s) });
  ev.push({ at: at(now, 4, 13, 15), run: (s, ctx) => keep(receiveMoney(s, { from: contactParty(s, rng), amount: localNice(25, cur), accountId: MAIN_ACCOUNT_ID, note: 'Cab home' }, ctx), s) });
  return ev;
}

function tradeEvents(c: Ctx, plan: Array<[number, string, 'buy' | 'sell', number]>): Event[] {
  return plan.map(([daysAgo, symbol, side, value]) => ({
    at: at(c.now, daysAgo, 15, 30 + (daysAgo % 25)),
    run: (s: AppState, ctx: OpContext) => {
      const asset = ASSET_MAP.get(symbol);
      if (!asset) return s;
      const price = demoQuote(asset, ctx.now.getTime());
      if (side === 'buy') return keep(executeTrade(s, { symbol, side, price, notional: Math.round(value * 100) }, ctx), s);
      const pos = s.markets.positions[symbol];
      if (!pos) return s;
      const qty = new Big(pos.quantity).times(value).round(asset.qtyDp, Big.roundDown).toString();
      if (Number(qty) <= 0) return s;
      return keep(executeTrade(s, { symbol, side, price, quantity: qty }, ctx), s);
    },
  }));
}

const INVESTOR_PLAN: Array<[number, string, 'buy' | 'sell', number]> = [
  [200, 'US500', 'buy', 12000],
  [188, 'AAPL', 'buy', 6000],
  [176, 'NVDA', 'buy', 7500],
  [165, 'MSFT', 'buy', 5000],
  [150, 'XAUUSD', 'buy', 6000],
  [139, 'BTC', 'buy', 8000],
  [121, 'ETH', 'buy', 3000],
  [104, 'EURUSD', 'buy', 10000],
  [83, 'AMZN', 'buy', 3000],
  [61, 'US100', 'buy', 4000],
  [46, 'NVDA', 'sell', 0.4],
  [31, 'BTC', 'sell', 0.25],
  [22, 'SOL', 'buy', 1500],
  [12, 'GOOGL', 'buy', 2500],
  [7, 'AAPL', 'sell', 0.3],
  [3, 'DE40', 'buy', 2000],
  [1, 'XAGUSD', 'buy', 1200],
];

const PREMIUM_PLAN: Array<[number, string, 'buy' | 'sell', number]> = [
  [150, 'US500', 'buy', 8000],
  [120, 'MSFT', 'buy', 4000],
  [90, 'XAUUSD', 'buy', 5000],
  [60, 'BTC', 'buy', 3000],
  [20, 'BTC', 'sell', 0.2],
];

const EVERYDAY_PLAN: Array<[number, string, 'buy' | 'sell', number]> = [
  [70, 'US500', 'buy', 500],
  [35, 'AAPL', 'buy', 250],
];

const PROVISIONAL = 50_000_000_000; // generous temporary opening while sample history is generated

function nextMonthlyDate(now: Date, day: number): string {
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), day);
  const d = thisMonth.getTime() > now.getTime() ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, day);
  return dayKey(d);
}

/** Creates a complete, ledger-consistent initial state for the chosen preset. */
export function createInitialState(opts: SetupOptions): AppState {
  const id = opts.id ?? makeId;
  const rng = mulberry32(opts.seed ?? (opts.now.getTime() & 0x7fffffff));
  const now = opts.now;
  const sample = opts.sampleTransactions && opts.preset !== 'sandbox';
  const historyStart = at(now, sample ? (opts.preset === 'investor' || opts.preset === 'premium' ? 210 : 100) : 0, 8, 0);
  const openedAt = sample ? historyStart : now;
  const octx = (d: Date): OpContext => ({ now: d, id });
  let s = baseState(opts);
  const specs = accountsFor(opts);

  // 1. Accounts (provisional openings while generating history).
  for (const a of specs) {
    const r = createAccount(
      s,
      {
        id: a.id,
        kind: a.kind,
        name: a.name,
        currency: a.currency,
        opening: sample ? (a.kind === 'credit' ? 0 : PROVISIONAL) : Math.abs(a.target),
        color: a.color,
        icon: a.icon,
        showOnDashboard: a.show,
        credit: a.credit ? { limit: a.credit.limit, statementBalance: a.credit.statement, dueDate: dayKey(addDays(now, a.credit.dueInDays)) } : undefined,
      },
      octx(openedAt),
    );
    if (r.ok) s = r.state;
  }

  // 2. Cards.
  const holder = cleanText(opts.displayName).toUpperCase() || 'ALEX MORGAN';
  for (const spec of cardsFor(opts)) {
    const acc = s.accounts.find((a) => a.id === spec.accountId);
    if (!acc) continue;
    const input: CardInput = {
      nickname: spec.nickname,
      holderName: holder.slice(0, 26),
      issuerName: 'VELTRIX',
      style: spec.style,
      customFrom: '#1E293B',
      customTo: '#0F766E',
      accent: spec.accent,
      pattern: spec.pattern,
      network: spec.network,
      kind: spec.kind,
      accountId: spec.accountId,
      displayDigits: String(1000 + Math.floor(rng() * 9000)),
      expiry: `${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}/${String((now.getFullYear() + 3 + Math.floor(rng() * 3)) % 100).padStart(2, '0')}`,
      showExpiry: true,
      spendLimit: spec.limitUsd > 0 ? localNice(spec.limitUsd, acc.currency) : 0,
      spendOverride: null,
    };
    const r = createCard(s, input, octx(openedAt));
    if (r.ok) s = r.state;
  }

  // 3. Contacts.
  CONTACTS.slice(0, CONTACT_COUNT[opts.preset]).forEach((c, i) => {
    const r = createContact(s, { ...c, color: AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length], favorite: i < 4 }, octx(openedAt));
    if (r.ok) s = r.state;
  });

  // 4. Goals, budgets, recurring rules and bills.
  const cur = opts.currency;
  if (opts.preset === 'everyday' || opts.preset === 'premium') {
    const big = opts.preset === 'premium';
    for (const g of big
      ? [
          { name: 'New car', usd: 30000, icon: 'briefcase' as const, color: ACCOUNT_COLORS[2], months: 14 },
          { name: 'Home deposit', usd: 80000, icon: 'home' as const, color: ACCOUNT_COLORS[3], months: 30 },
        ]
      : [
          { name: 'Emergency fund', usd: 5000, icon: 'vault' as const, color: ACCOUNT_COLORS[3], months: 10 },
          { name: 'Summer trip', usd: 2400, icon: 'plane' as const, color: ACCOUNT_COLORS[8], months: 8 },
        ]) {
      const r = createGoal(s, { name: g.name, target: localNice(g.usd, cur), deadline: dayKey(addMonths(now, g.months)), color: g.color, icon: g.icon, accountId: 'acc_savings' }, octx(openedAt));
      if (r.ok) s = r.state;
    }
    const budgets: Array<[Category, number]> = big
      ? [
          ['food', 1200],
          ['shopping', 1500],
          ['travel', 2500],
          ['entertainment', 400],
        ]
      : [
          ['food', 600],
          ['shopping', 300],
          ['entertainment', 150],
          ['transport', 120],
        ];
    for (const [cat, usd] of budgets) {
      const r = setBudget(s, cat, localNice(usd, cur), cur, octx(openedAt));
      if (r.ok) s = r.state;
    }
    const online = s.cards.find((c) => c.accountId === 'acc_card')?.id ?? s.cards[0]?.id;
    const debit = s.cards.find((c) => c.accountId === MAIN_ACCOUNT_ID)?.id;
    const rules = [
      { kind: 'purchase' as const, title: 'StreamBox', amount: localPrice(15.99, cur), fromAccountId: 'acc_card', cardId: online, category: 'subscriptions' as const, day: 14, sub: true },
      { kind: 'purchase' as const, title: 'CloudVault', amount: localPrice(2.99, cur), fromAccountId: 'acc_card', cardId: online, category: 'subscriptions' as const, day: 14, sub: true },
      { kind: 'purchase' as const, title: 'FitForge Gym', amount: localNice(39 * (big ? 1.8 : 1), cur), fromAccountId: MAIN_ACCOUNT_ID, cardId: debit, category: 'health' as const, day: 20, sub: true },
      { kind: 'transfer' as const, title: 'Monthly savings', amount: localNice(big ? 2000 : 400, cur), fromAccountId: 'acc_checking', toAccountId: 'acc_savings', category: 'transfers' as const, day: 6, sub: false },
    ];
    for (const r0 of rules) {
      const r = createRule(
        s,
        {
          kind: r0.kind,
          title: r0.title,
          amount: r0.amount,
          currency: cur,
          fromAccountId: r0.fromAccountId,
          toAccountId: 'toAccountId' in r0 ? r0.toAccountId : undefined,
          cardId: 'cardId' in r0 ? r0.cardId : undefined,
          category: r0.category,
          note: '',
          frequency: 'monthly',
          nextDate: nextMonthlyDate(now, r0.day),
          active: true,
          isSubscription: r0.sub,
        },
        octx(openedAt),
      );
      if (r.ok) s = r.state;
    }
    const bills = [
      { name: 'Volt Energy Co.', usd: 94.2, days: 6, repeat: 'monthly' as const, remind: 3 },
      { name: 'FiberNet Home', usd: 49.99, days: 12, repeat: 'monthly' as const, remind: 3 },
      ...(big ? [{ name: 'Home insurance', usd: 640, days: 26, repeat: 'yearly' as const, remind: 7 }] : []),
    ];
    for (const b of bills) {
      const r = createBill(
        s,
        { name: b.name, amount: localExact(b.usd, cur), currency: cur, dueDate: dayKey(addDays(now, b.days)), repeat: b.repeat, accountId: 'acc_checking', remindDaysBefore: b.remind },
        octx(openedAt),
      );
      if (r.ok) s = r.state;
    }
  } else if (opts.preset === 'minimal') {
    const r = setBudget(s, 'food', localNice(400, cur), cur, octx(openedAt));
    if (r.ok) s = r.state;
  }

  // 5. Watchlist and FX favourites.
  if (opts.preset === 'investor') s = { ...s, markets: { ...s.markets, watchlist: [...DEFAULT_WATCHLIST, 'MSFT', 'ETH', 'GBPUSD', 'DE40', 'XAGUSD', 'US100'] } };
  const pairs: Array<[CurrencyCode, CurrencyCode]> = [];
  const addPair = (a: CurrencyCode, b: CurrencyCode) => {
    if (a !== b && !pairs.some(([x, y]) => x === a && y === b)) pairs.push([a, b]);
  };
  addPair(cur, cur === 'EUR' ? 'USD' : 'EUR');
  addPair('EUR', 'USD');
  addPair('USD', 'JPY');
  addPair('GBP', 'EUR');
  addPair('EUR', 'ALL');
  addPair('USD', 'TRY');
  s = { ...s, fx: { ...s.fx, favorites: pairs.slice(0, 6) } };

  // 6. Sample history through the real operations.
  if (sample) {
    const c: Ctx = { state: s, rng, id, cur, now, scale: opts.preset === 'premium' ? 1.8 : 1 };
    let events: Event[] = [];
    if (opts.preset === 'minimal') events = lightEvents(c);
    else if (opts.preset === 'everyday') events = everydayEvents(c, true);
    else if (opts.preset === 'premium') events = everydayEvents(c, true);
    else if (opts.preset === 'investor') events = lightEvents(c).concat(everydayEvents({ ...c, scale: 1.1 }, false).filter((_, i) => i % 3 === 0));
    if (opts.marketDemo) {
      if (opts.preset === 'investor') events = events.concat(tradeEvents(c, INVESTOR_PLAN));
      if (opts.preset === 'premium') events = events.concat(tradeEvents(c, PREMIUM_PLAN));
      if (opts.preset === 'everyday') events = events.concat(tradeEvents(c, EVERYDAY_PLAN));
    }
    const cutoff = now.getTime() - 60_000;
    events = events.filter((e) => e.at.getTime() > openedAt.getTime() && e.at.getTime() < cutoff).sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const e of events) {
      try {
        s = e.run(s, octx(e.at));
      } catch {
        // A failed sample step is skipped; the state stays consistent because ops are pure.
      }
    }
    s = settleOpenings(s, new Map(specs.map((a) => [a.id, { target: a.target, exact: a.id === MAIN_ACCOUNT_ID }])), openedAt, now, id);
  }

  // Schedules that already ran in the sample history report those runs.
  s = {
    ...s,
    recurring: s.recurring.map((r) => {
      const runs = s.transactions.filter((t) => t.links?.ruleId === r.id);
      return runs.length ? { ...r, runs: runs.length, lastRunAt: runs[runs.length - 1].createdAt } : r;
    }),
  };

  // 7. Defaults, welcome notification, clean idempotency log.
  const firstCard = [...s.cards].sort((a, b) => a.order - b.order)[0];
  s = {
    ...s,
    settings: { ...s.settings, defaultCardId: firstCard?.id ?? '' },
    meta: { ...s.meta, processedOps: [] },
    notifications: [],
  };
  s = pushNotification(s, octx(now), 'system', 'Welcome to VELTRIX', 'Everything in this app is a simulation. No real money, cards or accounts are involved.', { screen: 'about' });
  return s;
}

/**
 * Replaces provisional opening balances with the smallest consistent opening
 * so that (a) no asset balance ever dips below zero in the generated history,
 * (b) credit stays within its limit and (c) each account ends on (or, when
 * (a)/(b) require it, slightly above) its suggested balance. For accounts with
 * an exact target (the main wallet's chosen starting balance) a visible
 * "Starting balance set" adjustment brings the account to the exact amount.
 */
export function settleOpenings(
  state: AppState,
  targets: Map<string, { target: number; exact: boolean }>,
  openedAt: Date,
  now: Date,
  id: (p: string) => string,
): AppState {
  let s: AppState = { ...state, transactions: state.transactions.filter((t) => !(t.subtype === 'opening' && targets.has(t.accountId))) };
  const r = rebuildSnapshots(s);
  const openings = [];
  const aligns: Array<{ accountId: string; delta: number }> = [];
  for (const [accountId, { target, exact }] of targets) {
    const acc = r.state.accounts.find((a) => a.id === accountId);
    if (!acc) continue;
    const net = acc.balance;
    const minR = r.minBalance.get(accountId) ?? 0;
    const maxR = r.maxBalance.get(accountId) ?? 0;
    let opening: number;
    if (acc.kind === 'credit') {
      const limit = acc.credit?.limit ?? 0;
      const lo = -limit - minR;
      const hi = -maxR;
      opening = Math.min(hi, Math.max(lo, target - net));
    } else {
      opening = Math.max(target - net, -minR);
    }
    if (opening !== 0) {
      openings.push(
        newTxn(
          { now: openedAt, id },
          {
            type: 'adjustment',
            subtype: 'opening',
            title: acc.kind === 'credit' ? 'Opening used credit' : 'Opening balance',
            amount: Math.abs(opening),
            currency: acc.currency,
            direction: opening > 0 ? 'in' : 'out',
            accountId,
            category: 'other',
            applied: true,
          },
        ),
      );
    }
    const final = opening + net;
    if (exact && final !== target) aligns.push({ accountId, delta: target - final });
  }
  s = rebuildSnapshots({ ...s, transactions: [...openings, ...s.transactions] }).state;
  const alignAt = new Date(now.getTime() - 30_000);
  for (const al of aligns) {
    const acc = s.accounts.find((a) => a.id === al.accountId);
    if (!acc) continue;
    s = postTxn(
      s,
      newTxn(
        { now: alignAt, id },
        {
          type: 'adjustment',
          subtype: 'starting',
          title: 'Starting balance set',
          amount: Math.abs(al.delta),
          currency: acc.currency,
          direction: al.delta > 0 ? 'in' : 'out',
          accountId: acc.id,
          category: 'other',
          applied: true,
        },
      ),
    );
  }
  return s;
}

/** A state used only to render the setup wizard behind the scenes (never persisted). */
export function previewState(now: Date): AppState {
  return createInitialState({
    preset: 'sandbox',
    displayName: 'Alex Morgan',
    currency: 'USD',
    theme: 'dark',
    startingBalance: 0,
    cardStyle: 'obsidian',
    sampleTransactions: false,
    marketDemo: true,
    now,
    seed: 1,
  });
}
