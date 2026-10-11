/**
 * Thin wrapper around the Android shell's JavaScript bridge
 * (`window.VeltrixNative`, see android/.../WebAppBridge.java) with browser
 * fallbacks so the same UI runs in the web preview and in tests.
 *
 * No financial operation ever goes through here — the bridge only offers
 * storage, haptics, system-bar theming, clipboard/share, file saving,
 * the home-screen widget and device-credential app lock.
 */

interface NativeBridge {
  getPlatformInfo(): string;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): boolean;
  storageRemove(key: string): void;
  haptic(kind: string): void;
  setTheme(mode: string, dark: boolean, background: string): void;
  getInsets(): string;
  copyText(text: string): boolean;
  shareText(text: string, title: string): void;
  saveDocument(requestId: string, filename: string, mime: string, content: string): void;
  updateWidget(json: string): void;
  isDeviceSecure(): boolean;
  authenticate(requestId: string, title: string, subtitle: string): void;
  openExternal(url: string): void;
  exitApp(): void;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  ime: number;
}

declare global {
  interface Window {
    VeltrixNative?: NativeBridge;
    __veltrixInsets?: (insets: Insets) => void;
    __veltrixBack?: () => boolean;
    __veltrixLifecycle?: (state: 'pause' | 'resume') => void;
    __veltrixSystemTheme?: (dark: boolean) => void;
    __veltrixNativeResolve?: (requestId: string, ok: boolean, message: string) => void;
  }
}

const native = (): NativeBridge | undefined => (typeof window !== 'undefined' ? window.VeltrixNative : undefined);

export const isNative = (): boolean => !!native();

export interface PlatformInfo {
  platform: 'android' | 'web';
  sdk: number;
  appVersion: string;
  webView: string;
}

export function platformInfo(): PlatformInfo {
  const n = native();
  if (n) {
    try {
      const j = JSON.parse(n.getPlatformInfo()) as Partial<PlatformInfo>;
      return { platform: 'android', sdk: Number(j.sdk) || 0, appVersion: String(j.appVersion ?? '1.0.0'), webView: String(j.webView ?? '') };
    } catch {
      /* fall through */
    }
  }
  return { platform: 'web', sdk: 0, appVersion: '1.0.0', webView: typeof navigator !== 'undefined' ? navigator.userAgent : '' };
}

/* ----------------------------- Storage ----------------------------- */

export const storage = {
  get(key: string): string | null {
    const n = native();
    if (n) return n.storageGet(key);
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Returns false when the write failed (quota, disk full, private mode). */
  set(key: string, value: string): boolean {
    const n = native();
    if (n) {
      try {
        return n.storageSet(key, value);
      } catch {
        return false;
      }
    }
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    const n = native();
    if (n) {
      n.storageRemove(key);
      return;
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/* ----------------------------- Haptics ----------------------------- */

export type HapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error';

export function haptic(kind: HapticKind): void {
  const n = native();
  if (n) {
    n.haptic(kind);
    return;
  }
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(kind === 'success' ? [8, 40, 12] : kind === 'error' ? [20, 40, 20] : 6);
    } catch {
      /* ignore */
    }
  }
}

/* --------------------------- System bars --------------------------- */

export function setSystemBars(mode: string, dark: boolean, background: string): void {
  native()?.setTheme(mode, dark, background);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', background);
}

/* ------------------------- Clipboard / share ----------------------- */

export async function copyText(text: string): Promise<boolean> {
  const n = native();
  if (n) return n.copyText(text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* try the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(text: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  const n = native();
  if (n) {
    n.shareText(text, title);
    return 'shared';
  }
  const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'failed';
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/* --------------------------- Native calls -------------------------- */

const pending = new Map<string, (ok: boolean, message: string) => void>();
let reqSeq = 0;

if (typeof window !== 'undefined') {
  window.__veltrixNativeResolve = (id, ok, message) => {
    const cb = pending.get(id);
    if (cb) {
      pending.delete(id);
      cb(ok, message);
    }
  };
}

function nativeRequest(start: (id: string) => void, timeoutMs = 120_000): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const id = `r${++reqSeq}`;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, message: 'timeout' });
    }, timeoutMs);
    pending.set(id, (ok, message) => {
      window.clearTimeout(timer);
      resolve({ ok, message });
    });
    try {
      start(id);
    } catch (e) {
      pending.delete(id);
      window.clearTimeout(timer);
      resolve({ ok: false, message: String(e) });
    }
  });
}

/** Saves a text file: Android system "Save as" dialog, or a browser download. */
export async function saveTextFile(filename: string, mime: string, content: string): Promise<{ ok: boolean; message: string }> {
  const n = native();
  if (n) return nativeRequest((id) => n.saveDocument(id, filename, mime, content));
  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, message: 'downloaded' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

export interface WidgetPayload {
  title: string;
  subtitle: string;
  amount: string;
  colorFrom: string;
  colorTo: string;
  digits: string;
  frozen: boolean;
}

export function updateWidget(payload: WidgetPayload | null): void {
  native()?.updateWidget(JSON.stringify(payload ?? {}));
}

export function deviceLockAvailable(): boolean {
  const n = native();
  return !!n && n.isDeviceSecure();
}

/** Asks Android for the device PIN/pattern/biometric. Resolves true when verified. */
export async function authenticate(title: string, subtitle: string): Promise<boolean> {
  const n = native();
  if (!n) return false;
  const r = await nativeRequest((id) => n.authenticate(id, title, subtitle), 300_000);
  return r.ok;
}

export function openExternal(url: string): void {
  if (!/^https:\/\//.test(url)) return;
  const n = native();
  if (n) n.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function exitApp(): void {
  native()?.exitApp();
}

export function nativeInsets(): Insets | null {
  const n = native();
  if (!n) return null;
  try {
    return JSON.parse(n.getInsets()) as Insets;
  } catch {
    return null;
  }
}
