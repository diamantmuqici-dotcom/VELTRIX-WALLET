import { useSyncExternalStore } from 'react';
import { CURRENCIES } from '../domain/currency';
import { makeId } from '../domain/ids';
import { formatMoney } from '../domain/money';
import { raiseBillReminders, runDueRules } from '../domain/ops/planning';
import type { AppState, OpContext, OpResult } from '../domain/types';
import { isNative, updateWidget } from '../platform/bridge';
import { cardGradient } from '../ui/cardStyles';
import { clearStorage, loadFromStorage, markGoodCopy, saveToStorage } from './persistence';

/**
 * The single source of truth for simulator data.
 *
 * Every mutation goes through `run(op)`: the domain operation receives the
 * current immutable state and returns either a complete new state (applied
 * atomically in one assignment) or an error, in which case nothing changes.
 */

export type Phase = 'loading' | 'setup' | 'ready' | 'recovery';

export interface Snapshot {
  phase: Phase;
  app: AppState | null;
  recoveryErrors: string[];
  notices: string[];
  saveFailed: boolean;
}

let snap: Snapshot = { phase: 'loading', app: null, recoveryErrors: [], notices: [], saveFailed: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<Snapshot>): void {
  snap = { ...snap, ...patch };
  emit();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSnapshot(): Snapshot {
  return snap;
}

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Only call from screens rendered in the `ready` phase. */
export function useApp(): AppState {
  const s = useSnapshot();
  return s.app as AppState;
}

export function opContext(): OpContext {
  return { now: new Date(), id: makeId };
}

/* ------------------------------ Saving ----------------------------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

export function flush(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty || !snap.app) return;
  dirty = false;
  const ok = saveToStorage(snap.app);
  if (ok === snap.saveFailed) set({ saveFailed: !ok });
}

/* ------------------------------ Widget ----------------------------- */

let lastWidget = '';

function syncWidget(s: AppState): void {
  if (!isNative()) return;
  const card = s.cards.find((c) => c.id === s.settings.defaultCardId) ?? [...s.cards].sort((a, b) => a.order - b.order)[0];
  const main = s.accounts.find((a) => a.id === 'acc_main');
  const showAmount = s.settings.widgetShowBalance && !s.settings.hideBalances && main;
  const payload = card
    ? {
        title: `${card.nickname} · DEMO`,
        subtitle: 'VELTRIX simulator — not a real card',
        amount: showAmount && main ? formatMoney(main.balance, main.currency, { locale: s.settings.numberLocale }) : `${CURRENCIES[main?.currency ?? 'USD'].symbol} ••••`,
        colorFrom: cardGradient(card).from,
        colorTo: cardGradient(card).to,
        digits: card.displayDigits,
        frozen: card.status === 'frozen',
      }
    : null;
  const json = JSON.stringify(payload);
  if (json === lastWidget) return;
  lastWidget = json;
  updateWidget(payload);
}

/* ----------------------------- Mutations --------------------------- */

export function commit(next: AppState): void {
  if (next === snap.app) return;
  set({ app: next });
  scheduleSave();
  syncWidget(next);
}

export function run<T extends object>(op: (s: AppState, ctx: OpContext) => OpResult<T>): OpResult<T> {
  const current = snap.app;
  if (!current) return { ok: false, error: 'invalid_input', detail: 'The simulator is not ready yet.' };
  let r: OpResult<T>;
  try {
    r = op(current, opContext());
  } catch (e) {
    console.error('VELTRIX operation failed', e instanceof Error ? e.message : 'unknown');
    return { ok: false, error: 'invalid_input', detail: 'Something went wrong — nothing was changed.' };
  }
  if (r.ok && !r.duplicate) commit(r.state);
  return r;
}

export function update(fn: (s: AppState) => AppState): void {
  const current = snap.app;
  if (!current) return;
  commit(fn(current));
}

/* ----------------------------- Lifecycle --------------------------- */

function startupRoutines(state: AppState): AppState {
  const ctx = opContext();
  let s: AppState = { ...state, meta: { ...state.meta, lastOpenedAt: ctx.now.toISOString() } };
  s = runDueRules(s, ctx).state;
  s = raiseBillReminders(s, ctx);
  return s;
}

export function init(): void {
  const out = loadFromStorage();
  if (out.kind === 'empty') {
    set({ phase: 'setup', app: null });
    return;
  }
  if (out.kind === 'corrupt') {
    set({ phase: 'recovery', recoveryErrors: out.errors, app: null });
    return;
  }
  const s = startupRoutines(out.state);
  set({ phase: 'ready', app: s, notices: out.warnings });
  scheduleSave();
  syncWidget(s);
}

/** Called when the app returns to the foreground: runs any rules that became due. */
export function onResume(): void {
  if (snap.phase !== 'ready' || !snap.app) return;
  const next = startupRoutines(snap.app);
  commit(next);
}

export function finishSetup(state: AppState): void {
  set({ phase: 'ready', app: state, notices: [] });
  dirty = true;
  flush();
  markGoodCopy(state);
  syncWidget(state);
}

/** Removes every simulator record from the device and returns to the setup wizard. */
export function resetAll(): void {
  if (saveTimer) clearTimeout(saveTimer);
  dirty = false;
  clearStorage();
  lastWidget = '';
  updateWidget(null);
  set({ phase: 'setup', app: null, notices: [], saveFailed: false });
}

export function replaceState(state: AppState): void {
  commit(state);
  flush();
  markGoodCopy(state);
}

export function dismissNotice(index: number): void {
  set({ notices: snap.notices.filter((_, i) => i !== index) });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else onResume();
  });
}
