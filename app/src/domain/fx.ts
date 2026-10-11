import Big from 'big.js';
import { CURRENCY_CODES, isCurrencyCode, type CurrencyCode } from './currency';
import type { RateSnapshot } from './types';

/**
 * Exchange-rate lookup — deliberately separate from simulated balance
 * accounting. A rate is only ever *read* here; balances move exclusively
 * through the ledger's `exchange` operation.
 */

/** Bundled demonstration rates. Approximate sample values, NOT market data. */
export const DEMO_RATES: RateSnapshot = {
  base: 'USD',
  rates: {
    USD: '1',
    EUR: '0.8600',
    GBP: '0.7450',
    CHF: '0.8000',
    JPY: '147.50',
    CAD: '1.3750',
    AUD: '1.5300',
    ALL: '83.50',
    TRY: '41.20',
    SEK: '9.450',
    NOK: '10.100',
    PLN: '3.650',
    CNY: '7.150',
    INR: '87.50',
    AED: '3.6725',
    MXN: '18.600',
  },
  publishedAt: '2026-01-01T00:00:00.000Z',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  provider: 'VELTRIX bundled sample rates',
  kind: 'demo',
};

export const LIVE_RATES_URL = 'https://open.er-api.com/v6/latest/USD';
export const LIVE_PROVIDER = 'ExchangeRate-API (open access)';
export const LIVE_PROVIDER_URL = 'https://www.exchangerate-api.com';

/** Rates older than this (by provider publish time) are flagged as stale. */
export const STALE_AFTER_MS = 36 * 3600 * 1000;
/** Re-fetch live rates after this long. */
export const REFRESH_AFTER_MS = 60 * 60 * 1000;

/** units of `to` per 1 unit of `from`, or null when either side is missing. */
export function crossRate(snapshot: RateSnapshot | null, from: CurrencyCode, to: CurrencyCode): string | null {
  if (from === to) return '1';
  if (!snapshot) return null;
  const rf = snapshot.rates[from];
  const rt = snapshot.rates[to];
  if (!rf || !rt) return null;
  try {
    const f = new Big(rf);
    const t = new Big(rt);
    if (f.lte(0) || t.lte(0)) return null;
    return new Big(t.div(f).toPrecision(10)).toString();
  } catch {
    return null;
  }
}

/** Converts minor units for display purposes (totals across currencies). Returns null if no rate. */
export function convertForDisplay(amountMinor: number, from: CurrencyCode, to: CurrencyCode, snapshot: RateSnapshot | null, fromDec: number, toDec: number): number | null {
  if (from === to) return amountMinor;
  const r = crossRate(snapshot, from, to);
  if (!r) return null;
  const v = new Big(amountMinor).div(10 ** fromDec).times(r).times(10 ** toDec).round(0, Big.roundHalfUp);
  return Number(v.toString());
}

export type RateStatusKind = 'live' | 'cached' | 'stale' | 'demo';

export interface RateStatus {
  kind: RateStatusKind;
  title: string;
  detail: string;
}

export function describeRates(snapshot: RateSnapshot, now: Date, online: boolean, timeLabel: (iso: string) => string): RateStatus {
  if (snapshot.kind === 'demo') {
    return {
      kind: 'demo',
      title: 'Demo rates',
      detail: 'Sample rates bundled with the app for demonstration. Not live market data.',
    };
  }
  const age = now.getTime() - new Date(snapshot.publishedAt).getTime();
  if (age > STALE_AFTER_MS) {
    return {
      kind: 'stale',
      title: 'Outdated indicative rates',
      detail: `Published ${timeLabel(snapshot.publishedAt)} by ${snapshot.provider}. They may differ significantly from current rates.`,
    };
  }
  if (snapshot.kind === 'cached' || !online) {
    return {
      kind: 'cached',
      title: online ? 'Cached indicative rates' : 'Offline — cached indicative rates',
      detail: `Published ${timeLabel(snapshot.publishedAt)} by ${snapshot.provider}. Indicative only; actual provider rates differ.`,
    };
  }
  return {
    kind: 'live',
    title: 'Indicative rates',
    detail: `Published ${timeLabel(snapshot.publishedAt)} by ${snapshot.provider}. Indicative only; actual provider rates differ.`,
  };
}

/** Validates and converts an open.er-api.com style payload. Returns null for anything unexpected. */
export function parseLiveRates(json: unknown, fetchedAt: Date): RateSnapshot | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  if (j.result !== 'success' || j.base_code !== 'USD') return null;
  const rates = j.rates as Record<string, unknown> | undefined;
  const ts = j.time_last_update_unix;
  if (!rates || typeof rates !== 'object' || typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  const out: Partial<Record<CurrencyCode, string>> = {};
  for (const code of CURRENCY_CODES) {
    const v = rates[code];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[code] = String(v);
  }
  if (out.USD === undefined) out.USD = '1';
  if (Object.keys(out).length < 5) return null;
  return {
    base: 'USD',
    rates: out,
    publishedAt: new Date(ts * 1000).toISOString(),
    fetchedAt: fetchedAt.toISOString(),
    provider: LIVE_PROVIDER,
    kind: 'live',
  };
}

/** The snapshot to use: fresh/cached live rates when allowed and available, otherwise bundled demo rates. */
export function activeSnapshot(liveCache: RateSnapshot | null, liveEnabled: boolean, fetchedThisSession: boolean): RateSnapshot {
  if (liveEnabled && liveCache) return { ...liveCache, kind: fetchedThisSession ? 'live' : 'cached' };
  return DEMO_RATES;
}

export function formatRate(rate: string | null, locale = 'en-US'): string {
  if (!rate) return '—';
  const n = Number(rate);
  if (!Number.isFinite(n)) return '—';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : n >= 0.01 ? 5 : 7;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits }).format(n);
}

export function pairKey(a: CurrencyCode, b: CurrencyCode): string {
  return `${a}/${b}`;
}

export function isPair(p: unknown): p is [CurrencyCode, CurrencyCode] {
  return Array.isArray(p) && p.length === 2 && isCurrencyCode(p[0]) && isCurrencyCode(p[1]);
}
