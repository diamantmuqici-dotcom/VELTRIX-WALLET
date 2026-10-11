import { useEffect, useSyncExternalStore } from 'react';
import { activeSnapshot, LIVE_RATES_URL, parseLiveRates, REFRESH_AFTER_MS } from '../domain/fx';
import type { RateSnapshot } from '../domain/types';
import { getSnapshot, update } from './store';

/**
 * Optional live *indicative* FX rates. Only fetched when the user turned on
 * "Live indicative rates". Rates are never used for anything but the
 * converter's display and simulated exchanges, which record the source.
 * Fictional transactions never touch the network.
 */

interface RateState {
  status: 'idle' | 'loading' | 'ok' | 'error' | 'offline';
  fetchedThisSession: boolean;
  error: string | null;
}

let rs: RateState = { status: 'idle', fetchedThisSession: false, error: null };
const listeners = new Set<() => void>();
const setRS = (p: Partial<RateState>) => {
  rs = { ...rs, ...p };
  for (const l of listeners) l();
};

export function useRateStatus(): RateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => rs,
    () => rs,
  );
}

let inflight: Promise<void> | null = null;

export function refreshLiveRates(force = false): Promise<void> {
  const app = getSnapshot().app;
  if (!app || !app.settings.liveRates) return Promise.resolve();
  const cache = app.fx.liveCache;
  if (!force && cache && Date.now() - new Date(cache.fetchedAt).getTime() < REFRESH_AFTER_MS && rs.fetchedThisSession) return Promise.resolve();
  if (inflight) return inflight;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setRS({ status: 'offline', error: 'You are offline. Showing cached or demo rates.' });
    return Promise.resolve();
  }
  setRS({ status: 'loading', error: null });
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), 8000);
  inflight = fetch(LIVE_RATES_URL, { signal: controller?.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((json: unknown) => {
      const snap = parseLiveRates(json, new Date());
      if (!snap) throw new Error('Unexpected response from the rate provider');
      update((s) => ({ ...s, fx: { ...s.fx, liveCache: snap } }));
      setRS({ status: 'ok', fetchedThisSession: true, error: null });
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error && e.name === 'AbortError' ? 'The rate provider did not respond in time.' : 'Live rates are unavailable right now.';
      setRS({ status: 'error', error: msg });
    })
    .finally(() => {
      clearTimeout(timer);
      inflight = null;
    });
  return inflight;
}

/** The rates the UI should use right now (live/cached indicative or bundled demo). */
export function useRates(liveEnabled: boolean, liveCache: RateSnapshot | null): { snapshot: RateSnapshot; status: RateState } {
  const status = useRateStatus();
  useEffect(() => {
    if (liveEnabled) void refreshLiveRates();
  }, [liveEnabled]);
  return { snapshot: activeSnapshot(liveCache, liveEnabled, status.fetchedThisSession), status };
}
