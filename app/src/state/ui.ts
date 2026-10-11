import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Ephemeral UI state: per-tab navigation stacks (so every tab keeps its
 * place when you switch), bottom sheets, the confirm dialog and toasts.
 * Nothing here is persisted and nothing here touches simulator data.
 */

export type Tab = 'home' | 'wallet' | 'activity' | 'markets' | 'profile';
export const TABS: Tab[] = ['home', 'wallet', 'activity', 'markets', 'profile'];

export type RouteName =
  | Tab
  | 'send'
  | 'request'
  | 'receive'
  | 'cards'
  | 'cardDetail'
  | 'cardEdit'
  | 'cardPresent'
  | 'exchange'
  | 'asset'
  | 'portfolio'
  | 'orders'
  | 'txn'
  | 'accounts'
  | 'account'
  | 'accountEdit'
  | 'credit'
  | 'contacts'
  | 'contact'
  | 'contactEdit'
  | 'requests'
  | 'analytics'
  | 'notifications'
  | 'settings'
  | 'appearance'
  | 'dashboard'
  | 'preferences'
  | 'fees'
  | 'notificationPrefs'
  | 'security'
  | 'data'
  | 'about'
  | 'goals'
  | 'budgets'
  | 'recurring'
  | 'bills'
  | 'search';

export type Params = Record<string, string | undefined>;

export interface Route {
  key: string;
  name: RouteName;
  params: Params;
}

export interface SheetEntry {
  id: number;
  title?: string;
  render: (close: () => void) => ReactNode;
  /** full-height sheet (forms with keyboard) */
  tall?: boolean;
  /** called once when the sheet is removed for any reason */
  onClose?: () => void;
}

export interface DialogSpec {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface UIState {
  tab: Tab;
  stacks: Record<Tab, Route[]>;
  sheets: SheetEntry[];
  dialog: DialogSpec | null;
  toasts: Toast[];
  /** increments on every navigation so screens can reset scroll */
  navSeq: number;
  direction: 'forward' | 'back' | 'none';
}

let seq = 0;
const key = () => `r${++seq}`;

function rootStacks(): Record<Tab, Route[]> {
  return {
    home: [{ key: key(), name: 'home', params: {} }],
    wallet: [{ key: key(), name: 'wallet', params: {} }],
    activity: [{ key: key(), name: 'activity', params: {} }],
    markets: [{ key: key(), name: 'markets', params: {} }],
    profile: [{ key: key(), name: 'profile', params: {} }],
  };
}

let ui: UIState = { tab: 'home', stacks: rootStacks(), sheets: [], dialog: null, toasts: [], navSeq: 0, direction: 'none' };
const listeners = new Set<() => void>();

function set(patch: Partial<UIState>): void {
  ui = { ...ui, ...patch };
  for (const l of listeners) l();
}

export function subscribeUI(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getUI(): UIState {
  return ui;
}

export function useUI(): UIState {
  return useSyncExternalStore(subscribeUI, getUI, getUI);
}

/* ---------------------------- Navigation --------------------------- */

const TAB_HOME: Partial<Record<RouteName, Tab>> = { activity: 'activity', markets: 'markets', wallet: 'wallet', profile: 'profile', home: 'home' };

export const nav = {
  push(name: RouteName, params: Params = {}): void {
    if (TAB_HOME[name]) {
      nav.tab(TAB_HOME[name] as Tab);
      return;
    }
    const stack = ui.stacks[ui.tab];
    const top = stack[stack.length - 1];
    // Ignore accidental double-taps that would push the same screen twice.
    if (top.name === name && JSON.stringify(top.params) === JSON.stringify(params)) return;
    set({ stacks: { ...ui.stacks, [ui.tab]: [...stack, { key: key(), name, params }] }, navSeq: ui.navSeq + 1, direction: 'forward' });
  },
  replace(name: RouteName, params: Params = {}): void {
    const stack = ui.stacks[ui.tab];
    set({ stacks: { ...ui.stacks, [ui.tab]: [...stack.slice(0, -1), { key: key(), name, params }] }, navSeq: ui.navSeq + 1, direction: 'forward' });
  },
  pop(): boolean {
    const stack = ui.stacks[ui.tab];
    if (stack.length <= 1) return false;
    set({ stacks: { ...ui.stacks, [ui.tab]: stack.slice(0, -1) }, navSeq: ui.navSeq + 1, direction: 'back' });
    return true;
  },
  popToRoot(): void {
    const stack = ui.stacks[ui.tab];
    if (stack.length <= 1) return;
    set({ stacks: { ...ui.stacks, [ui.tab]: stack.slice(0, 1) }, navSeq: ui.navSeq + 1, direction: 'back' });
  },
  tab(t: Tab): void {
    if (t === ui.tab) {
      nav.popToRoot();
      return;
    }
    set({ tab: t, navSeq: ui.navSeq + 1, direction: 'none' });
  },
  /** Opens a screen on a specific tab (used by notifications and search). */
  open(t: Tab, name: RouteName, params: Params = {}): void {
    const base = ui.stacks[t].slice(0, 1);
    const stacks = { ...ui.stacks, [t]: name === t ? base : [...base, { key: key(), name, params }] };
    closeAllSheets();
    set({ tab: t, stacks, navSeq: ui.navSeq + 1, direction: 'forward' });
  },
  resetAll(): void {
    closeAllSheets();
    set({ tab: 'home', stacks: rootStacks(), dialog: null, navSeq: ui.navSeq + 1, direction: 'none' });
  },
};

export function currentRoute(): Route {
  const stack = ui.stacks[ui.tab];
  return stack[stack.length - 1];
}

/* ------------------------------ Sheets ----------------------------- */

let sheetSeq = 0;

export function openSheet(render: SheetEntry['render'], opts: { title?: string; tall?: boolean; onClose?: () => void } = {}): number {
  const id = ++sheetSeq;
  set({ sheets: [...ui.sheets, { id, render, title: opts.title, tall: opts.tall, onClose: opts.onClose }] });
  return id;
}

function removeSheets(keep: (s: SheetEntry) => boolean): void {
  const removed = ui.sheets.filter((s) => !keep(s));
  if (!removed.length) return;
  set({ sheets: ui.sheets.filter(keep) });
  for (const s of removed) s.onClose?.();
}

export function closeSheet(id?: number): void {
  if (ui.sheets.length === 0) return;
  const target = id ?? ui.sheets[ui.sheets.length - 1].id;
  removeSheets((s) => s.id !== target);
}

export function closeAllSheets(): void {
  removeSheets(() => false);
}

/* ------------------------------ Dialog ----------------------------- */

export function confirm(opts: Omit<DialogSpec, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (ui.dialog) ui.dialog.resolve(false);
    set({ dialog: { ...opts, resolve } });
  });
}

export function resolveDialog(ok: boolean): void {
  const d = ui.dialog;
  if (!d) return;
  set({ dialog: null });
  d.resolve(ok);
}

/* ------------------------------ Toasts ----------------------------- */

let toastSeq = 0;

export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']): void {
  const id = ++toastSeq;
  set({ toasts: [...ui.toasts.slice(-2), { id, text, tone, action }] });
  setTimeout(() => dismissToast(id), action ? 5000 : 2800);
}

export function dismissToast(id: number): void {
  if (ui.toasts.some((t) => t.id === id)) set({ toasts: ui.toasts.filter((t) => t.id !== id) });
}

/* --------------------------- Back handling ------------------------- */

const interceptors: Array<{ id: number; fn: () => boolean }> = [];
let interceptorSeq = 0;

/** Lets a screen consume the back action (e.g. a multi-step flow going one step back). */
export function useBackInterceptor(fn: () => boolean, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = ++interceptorSeq;
    interceptors.push({ id, fn: () => ref.current() });
    return () => {
      const i = interceptors.findIndex((x) => x.id === id);
      if (i >= 0) interceptors.splice(i, 1);
    };
  }, [active]);
}

/** Returns true when the back action was handled inside the app. */
export function handleBack(): boolean {
  if (ui.dialog) {
    resolveDialog(false);
    return true;
  }
  if (ui.sheets.length) {
    closeSheet();
    return true;
  }
  for (let i = interceptors.length - 1; i >= 0; i--) {
    if (interceptors[i].fn()) return true;
  }
  if (nav.pop()) return true;
  if (ui.tab !== 'home') {
    nav.tab('home');
    return true;
  }
  return false;
}
