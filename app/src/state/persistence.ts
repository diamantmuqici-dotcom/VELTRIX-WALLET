import { loadState } from '../domain/schema';
import type { AppState } from '../domain/types';
import { storage } from '../platform/bridge';

/**
 * Local persistence. On Android the bridge writes through AtomicFile (a
 * crash mid-write can never leave a half-written file); in the browser
 * localStorage is used. Everything read back is re-validated.
 */

export const KEY_STATE = 'veltrix.state.v1';
export const KEY_PREV = 'veltrix.state.prev';
export const KEY_CORRUPT = 'veltrix.state.corrupt';

export type LoadOutcome =
  | { kind: 'empty' }
  | { kind: 'ok'; state: AppState; warnings: string[] }
  | { kind: 'corrupt'; errors: string[] };

function parse(raw: string): { ok: true; state: AppState; warnings: string[] } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['The saved file is not valid JSON (it may have been truncated).'] };
  }
  const r = loadState(json);
  return r.ok ? { ok: true, state: r.state, warnings: r.warnings } : { ok: false, errors: r.errors };
}

export function loadFromStorage(): LoadOutcome {
  const raw = storage.get(KEY_STATE);
  if (raw) {
    const first = parse(raw);
    if (first.ok) {
      storage.set(KEY_PREV, raw);
      return { kind: 'ok', state: first.state, warnings: first.warnings };
    }
    storage.set(KEY_CORRUPT, raw);
    const prevRaw = storage.get(KEY_PREV);
    if (prevRaw && prevRaw !== raw) {
      const prev = parse(prevRaw);
      if (prev.ok) {
        storage.set(KEY_STATE, prevRaw);
        return {
          kind: 'ok',
          state: prev.state,
          warnings: ['Your latest save could not be read, so VELTRIX restored the last good copy. The unreadable file was kept and can be exported from Settings → Data.'],
        };
      }
    }
    return { kind: 'corrupt', errors: first.errors };
  }
  const prevRaw = storage.get(KEY_PREV);
  if (prevRaw) {
    const prev = parse(prevRaw);
    if (prev.ok) return { kind: 'ok', state: prev.state, warnings: ['VELTRIX restored your data from the last good copy.'] };
  }
  return { kind: 'empty' };
}

export function saveToStorage(state: AppState): boolean {
  let json: string;
  try {
    json = JSON.stringify(state);
  } catch {
    return false;
  }
  return storage.set(KEY_STATE, json);
}

export function markGoodCopy(state: AppState): void {
  try {
    storage.set(KEY_PREV, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

export function corruptCopy(): string | null {
  return storage.get(KEY_CORRUPT);
}

export function clearCorruptCopy(): void {
  storage.remove(KEY_CORRUPT);
}

/** Removes all simulator data from this device. */
export function clearStorage(): void {
  storage.remove(KEY_STATE);
  storage.remove(KEY_PREV);
}
