import { isCurrencyCode } from './currency';
import { isDayKey } from './dates';
import { CATEGORIES, TXN_TYPES } from './labels';
import { rebuildSnapshots, verifyLedger } from './ledger';
import { MAX_BALANCE_MINOR } from './money';
import { DASHBOARD_ORDER, defaultSettings } from './presets';
import { SCHEMA_VERSION, type AppState, type DashboardSection, type Settings } from './types';
import { isHexColor } from './validation';

/**
 * Validation of persisted or imported data. Nothing from storage or a file is
 * trusted: every record is type-checked, the ledger is re-verified and
 * settings are merged over defaults so older files keep working.
 */

export const BACKUP_FORMAT = 'veltrix-backup';
export const BACKUP_DISCLAIMER = 'VELTRIX Wallet simulator backup. All balances, cards, accounts and trades are fictional. Not a bank statement.';

const MAX_TXNS = 50_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_BALANCE_MINOR;
const isIso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isDec = (v: unknown): v is string => typeof v === 'string' && /^-?\d{1,18}(\.\d{1,12})?$/.test(v);

class Checker {
  errors: string[] = [];
  need(cond: boolean, msg: string): boolean {
    if (!cond && this.errors.length < 25) this.errors.push(msg);
    return cond;
  }
}

function checkAccounts(c: Checker, v: unknown): void {
  if (!c.need(Array.isArray(v), 'accounts must be a list')) return;
  const ids = new Set<string>();
  (v as unknown[]).forEach((a, i) => {
    const p = `accounts[${i}]`;
    if (!c.need(isObj(a), `${p} is not an object`)) return;
    const o = a as Obj;
    c.need(isStr(o.id, 80) && !ids.has(o.id as string), `${p}.id missing or duplicated`);
    ids.add(o.id as string);
    c.need(['wallet', 'checking', 'savings', 'card', 'investment', 'foreign', 'credit'].includes(o.kind as string), `${p}.kind invalid`);
    c.need(isStr(o.name, 80), `${p}.name invalid`);
    c.need(isCurrencyCode(o.currency), `${p}.currency invalid`);
    c.need(isInt(o.balance), `${p}.balance must be integer minor units`);
    c.need(isStr(o.color, 20), `${p}.color invalid`);
    c.need(isBool(o.archived) && isBool(o.showOnDashboard), `${p} flags invalid`);
    if (o.kind === 'credit') {
      const cr = o.credit as Obj | undefined;
      c.need(isObj(cr) && isInt(cr.limit) && (cr.limit as number) > 0 && isInt(cr.statementBalance) && isDayKey(cr.dueDate), `${p}.credit invalid`);
    }
  });
  c.need(ids.has('acc_main'), 'the main wallet account is missing');
}

function checkTxns(c: Checker, v: unknown, accountIds: Set<string>): void {
  if (!c.need(Array.isArray(v), 'transactions must be a list')) return;
  const list = v as unknown[];
  c.need(list.length <= MAX_TXNS, `too many ledger entries (max ${MAX_TXNS})`);
  const ids = new Set<string>();
  for (let i = 0; i < list.length && c.errors.length < 25; i++) {
    const p = `transactions[${i}]`;
    const t = list[i];
    if (!c.need(isObj(t), `${p} is not an object`)) continue;
    const o = t as Obj;
    c.need(isStr(o.id, 80) && !ids.has(o.id as string), `${p}.id missing or duplicated`);
    ids.add(o.id as string);
    c.need(TXN_TYPES.includes(o.type as never), `${p}.type invalid`);
    c.need(['in', 'out', 'internal'].includes(o.direction as string), `${p}.direction invalid`);
    c.need(['completed', 'pending', 'canceled', 'reversed'].includes(o.status as string), `${p}.status invalid`);
    c.need(isInt(o.amount) && (o.amount as number) >= 0, `${p}.amount must be non-negative integer minor units`);
    c.need(isInt(o.fee) && (o.fee as number) >= 0, `${p}.fee invalid`);
    c.need(isCurrencyCode(o.currency), `${p}.currency invalid`);
    c.need(isStr(o.accountId, 80) && accountIds.has(o.accountId as string), `${p}.accountId unknown`);
    if (o.toAccountId !== undefined) c.need(isStr(o.toAccountId, 80) && accountIds.has(o.toAccountId as string), `${p}.toAccountId unknown`);
    if (o.direction === 'internal') c.need(o.toAccountId !== undefined, `${p} internal move without destination`);
    c.need(CATEGORIES.includes(o.category as never), `${p}.category invalid`);
    c.need(Array.isArray(o.tags) && (o.tags as unknown[]).every((x) => isStr(x, 40)), `${p}.tags invalid`);
    c.need(isIso(o.createdAt), `${p}.createdAt invalid`);
    c.need(isBool(o.applied), `${p}.applied invalid`);
    c.need(isStr(o.title, 200), `${p}.title invalid`);
    if (o.note !== undefined) c.need(isStr(o.note, 1000), `${p}.note invalid`);
    if (o.fx !== undefined) {
      const fx = o.fx as Obj;
      c.need(isObj(fx) && isCurrencyCode(fx.from) && isCurrencyCode(fx.to) && isDec(fx.rate) && isInt(fx.targetAmount), `${p}.fx invalid`);
    }
    if (o.trade !== undefined) {
      const tr = o.trade as Obj;
      c.need(isObj(tr) && isStr(tr.symbol, 20) && isDec(tr.quantity) && isDec(tr.price), `${p}.trade invalid`);
    }
  }
}

function checkCards(c: Checker, v: unknown, accountIds: Set<string>): void {
  if (!c.need(Array.isArray(v), 'cards must be a list')) return;
  (v as unknown[]).forEach((card, i) => {
    const p = `cards[${i}]`;
    if (!c.need(isObj(card), `${p} is not an object`)) return;
    const o = card as Obj;
    c.need(isStr(o.id, 80), `${p}.id invalid`);
    c.need(typeof o.displayDigits === 'string' && /^\d{4}$/.test(o.displayDigits), `${p}.displayDigits must be exactly 4 digits`);
    c.need(isStr(o.accountId, 80) && accountIds.has(o.accountId as string), `${p}.accountId unknown`);
    c.need(isStr(o.nickname, 80) && isStr(o.holderName, 80) && isStr(o.issuerName, 80), `${p} names invalid`);
    c.need(isHexColor(o.customFrom) && isHexColor(o.customTo) && isHexColor(o.accent), `${p} colors invalid`);
    c.need(isInt(o.spendLimit), `${p}.spendLimit invalid`);
    c.need(o.status === 'active' || o.status === 'frozen', `${p}.status invalid`);
  });
}

function checkMarkets(c: Checker, v: unknown): void {
  if (!c.need(isObj(v), 'markets missing')) return;
  const m = v as Obj;
  c.need(Array.isArray(m.watchlist) && (m.watchlist as unknown[]).every((x) => isStr(x, 20)), 'markets.watchlist invalid');
  c.need(isObj(m.positions), 'markets.positions invalid');
  if (isObj(m.positions)) {
    for (const [k, pos] of Object.entries(m.positions)) {
      const po = pos as Obj;
      c.need(isObj(po) && po.symbol === k && isDec(po.quantity) && isDec(po.avgCost), `position ${k} invalid`);
    }
  }
  c.need(Array.isArray(m.orders), 'markets.orders invalid');
  c.need(isInt(m.realizedPnl), 'markets.realizedPnl invalid');
}

function mergeSettings(raw: unknown, base: Settings): Settings {
  if (!isObj(raw)) return base;
  const r = raw as Partial<Settings>;
  const pick = <K extends keyof Settings>(k: K, ok: (v: unknown) => boolean): Settings[K] => (ok(r[k]) ? (r[k] as Settings[K]) : base[k]);
  const dashboard: DashboardSection[] = [];
  if (Array.isArray(r.dashboard)) {
    for (const d of r.dashboard) {
      if (isObj(d) && DASHBOARD_ORDER.includes(d.id as never) && isBool(d.visible) && !dashboard.some((x) => x.id === d.id)) dashboard.push({ id: d.id as DashboardSection['id'], visible: d.visible as boolean });
    }
  }
  for (const id of DASHBOARD_ORDER) if (!dashboard.some((x) => x.id === id)) dashboard.push({ id, visible: false });
  const fee = (v: unknown, d: Settings['fees']['exchange']) =>
    isObj(v) && [v.bps, v.fixed, v.min, v.max].every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1_000_000) ? (v as unknown as Settings['fees']['exchange']) : d;
  const fees = isObj(r.fees) ? r.fees : ({} as Obj);
  const notif = isObj(r.notifications) ? (r.notifications as Obj) : {};
  return {
    ...base,
    theme: pick('theme', (v) => v === 'light' || v === 'dark' || v === 'system'),
    accent: pick('accent', (v) => ['mint', 'violet', 'azure', 'amber', 'rose', 'emerald'].includes(v as string)),
    defaultCurrency: pick('defaultCurrency', isCurrencyCode),
    defaultAccountId: pick('defaultAccountId', (v) => isStr(v, 80)),
    defaultCardId: pick('defaultCardId', (v) => isStr(v, 80)),
    numberLocale: pick('numberLocale', (v) => ['en-US', 'de-DE', 'fr-FR', 'de-CH', 'en-IN'].includes(v as string)),
    hideBalances: pick('hideBalances', isBool),
    haptics: pick('haptics', isBool),
    animation: pick('animation', (v) => v === 'full' || v === 'reduced' || v === 'off'),
    notifications: {
      payments: isBool(notif.payments) ? notif.payments : true,
      requests: isBool(notif.requests) ? notif.requests : true,
      reminders: isBool(notif.reminders) ? notif.reminders : true,
      markets: isBool(notif.markets) ? notif.markets : true,
      budgets: isBool(notif.budgets) ? notif.budgets : true,
    },
    trackBalances: pick('trackBalances', isBool),
    fees: { instantSend: fee((fees as Obj).instantSend, base.fees.instantSend), exchange: fee((fees as Obj).exchange, base.fees.exchange), trade: fee((fees as Obj).trade, base.fees.trade) },
    dashboard,
    foreignWalletName: pick('foreignWalletName', (v) => isStr(v, 40)),
    liveRates: pick('liveRates', isBool),
    appLock: pick('appLock', isBool),
    widgetShowBalance: pick('widgetShowBalance', isBool),
  };
}

export type LoadResult =
  | { ok: true; state: AppState; repaired: boolean; warnings: string[] }
  | { ok: false; errors: string[] };

/** Brings older schema versions up to date. Returns null if the version is unsupported. */
export function migrate(raw: Obj): Obj | null {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (v > SCHEMA_VERSION) return null;
  let out = raw;
  if (v < 1) {
    // Pre-release files had no version; they share the v1 shape.
    out = { ...out, schemaVersion: 1 };
  }
  return out;
}

/** Validates an unknown value as AppState, migrating and repairing where safe. */
export function loadState(input: unknown): LoadResult {
  if (!isObj(input)) return { ok: false, errors: ['The data is not a VELTRIX state object.'] };
  let raw: Obj = input;
  if (raw.format === BACKUP_FORMAT) {
    if (!isObj(raw.state)) return { ok: false, errors: ['The backup file has no state section.'] };
    raw = raw.state as Obj;
  }
  const migrated = migrate(raw);
  if (!migrated) return { ok: false, errors: ['This file was created by a newer version of VELTRIX.'] };
  raw = migrated;
  const c = new Checker();
  c.need(isObj(raw.meta), 'meta missing');
  c.need(isObj(raw.profile), 'profile missing');
  checkAccounts(c, raw.accounts);
  const accountIds = new Set(Array.isArray(raw.accounts) ? (raw.accounts as Obj[]).map((a) => (isObj(a) ? (a.id as string) : '')) : []);
  checkTxns(c, raw.transactions, accountIds);
  checkCards(c, raw.cards, accountIds);
  c.need(Array.isArray(raw.contacts), 'contacts must be a list');
  c.need(Array.isArray(raw.requests), 'requests must be a list');
  checkMarkets(c, raw.markets);
  if (c.errors.length) return { ok: false, errors: c.errors };

  const meta = raw.meta as Obj;
  const profile = raw.profile as Obj;
  const accounts = raw.accounts as AppState['accounts'];
  const main = accounts.find((a) => a.id === 'acc_main');
  const base = defaultSettings(main?.currency ?? 'USD', 'system');
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const fx = isObj(raw.fx) ? (raw.fx as Obj) : {};
  const warnings: string[] = [];
  let state: AppState = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      createdAt: isIso(meta.createdAt) ? (meta.createdAt as string) : new Date().toISOString(),
      onboarded: meta.onboarded !== false,
      preset: ['minimal', 'everyday', 'premium', 'investor', 'sandbox'].includes(meta.preset as string) ? (meta.preset as AppState['meta']['preset']) : 'sandbox',
      lastOpenedAt: isIso(meta.lastOpenedAt) ? (meta.lastOpenedAt as string) : new Date().toISOString(),
      processedOps: arr<string>(meta.processedOps).filter((x) => isStr(x, 300)).slice(-200),
    },
    profile: {
      displayName: isStr(profile.displayName, 80) && profile.displayName ? (profile.displayName as string) : 'VELTRIX User',
      username: isStr(profile.username, 40) && profile.username ? (profile.username as string) : 'veltrix.user',
      walletId: isStr(profile.walletId, 40) && profile.walletId ? (profile.walletId as string) : 'VX-DEMO-0000-0000',
      avatarColor: isHexColor(profile.avatarColor) ? (profile.avatarColor as string) : '#7C6CF2',
      avatarImage: typeof profile.avatarImage === 'string' && profile.avatarImage.startsWith('data:image/') && profile.avatarImage.length < 400_000 ? profile.avatarImage : null,
      accent: isHexColor(profile.accent) ? (profile.accent as string) : '#7C6CF2',
    },
    settings: mergeSettings(raw.settings, base),
    accounts,
    cards: raw.cards as AppState['cards'],
    contacts: arr<AppState['contacts'][number]>(raw.contacts).filter((x) => isObj(x) && isStr(x.id) && isStr(x.name) && isStr(x.username)),
    transactions: raw.transactions as AppState['transactions'],
    requests: arr<AppState['requests'][number]>(raw.requests).filter((x) => isObj(x) && isStr(x.id) && isInt(x.amount) && isCurrencyCode(x.currency)),
    markets: {
      watchlist: (raw.markets as Obj).watchlist as string[],
      positions: (raw.markets as Obj).positions as AppState['markets']['positions'],
      orders: arr<AppState['markets']['orders'][number]>((raw.markets as Obj).orders).filter((o) => isObj(o) && isStr(o.id) && isDec(o.quantity) && isDec(o.price)),
      realizedPnl: (raw.markets as Obj).realizedPnl as number,
      demoEnabled: (raw.markets as Obj).demoEnabled !== false,
    },
    fx: {
      favorites: arr<[string, string]>(fx.favorites).filter((p) => Array.isArray(p) && p.length === 2 && isCurrencyCode(p[0]) && isCurrencyCode(p[1])) as AppState['fx']['favorites'],
      lookups: arr<AppState['fx']['lookups'][number]>(fx.lookups).filter((x) => isObj(x) && isCurrencyCode(x.from) && isCurrencyCode(x.to)).slice(0, 50),
      liveCache: isObj(fx.liveCache) && isObj((fx.liveCache as Obj).rates) && isIso((fx.liveCache as Obj).publishedAt) ? (fx.liveCache as unknown as AppState['fx']['liveCache']) : null,
    },
    goals: arr<AppState['goals'][number]>(raw.goals).filter((g) => isObj(g) && isStr(g.id) && isInt(g.target) && isInt(g.saved) && accountIds.has(g.accountId as string)),
    budgets: arr<AppState['budgets'][number]>(raw.budgets).filter((b) => isObj(b) && CATEGORIES.includes(b.category as never) && isInt(b.limit) && isCurrencyCode(b.currency)),
    recurring: arr<AppState['recurring'][number]>(raw.recurring).filter((r) => isObj(r) && isStr(r.id) && isInt(r.amount) && isDayKey(r.nextDate) && accountIds.has(r.fromAccountId as string)),
    bills: arr<AppState['bills'][number]>(raw.bills).filter((b) => isObj(b) && isStr(b.id) && isInt(b.amount) && isDayKey(b.dueDate) && accountIds.has(b.accountId as string)),
    notifications: arr<AppState['notifications'][number]>(raw.notifications).filter((n) => isObj(n) && isStr(n.id) && isStr(n.title) && isIso(n.createdAt)).slice(0, 100),
  };
  if (!state.accounts.some((a) => a.id === state.settings.defaultAccountId && !a.archived)) state = { ...state, settings: { ...state.settings, defaultAccountId: 'acc_main' } };
  if (state.settings.defaultCardId && !state.cards.some((c2) => c2.id === state.settings.defaultCardId)) state = { ...state, settings: { ...state.settings, defaultCardId: state.cards[0]?.id ?? '' } };
  let repaired = false;
  const v = verifyLedger(state);
  if (!v.ok) {
    state = rebuildSnapshots(state).state;
    repaired = true;
    warnings.push(`Stored balances for ${v.drift.length} account(s) did not match the ledger and were recomputed from it.`);
  }
  return { ok: true, state, repaired, warnings };
}

export function makeBackup(state: AppState, now: Date): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: SCHEMA_VERSION, exportedAt: now.toISOString(), disclaimer: BACKUP_DISCLAIMER, state }, null, 1);
}
