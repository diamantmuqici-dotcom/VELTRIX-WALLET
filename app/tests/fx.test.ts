import { describe, expect, it } from 'vitest';
import { PRIMARY_CURRENCIES } from '../src/domain/currency';
import { activeSnapshot, convertForDisplay, crossRate, DEMO_RATES, describeRates, formatRate, parseLiveRates } from '../src/domain/fx';

const label = (iso: string) => iso.slice(0, 16);

describe('exchange rates', () => {
  it('bundles demo rates for every required currency', () => {
    for (const c of PRIMARY_CURRENCIES) expect(DEMO_RATES.rates[c]).toBeDefined();
    expect(DEMO_RATES.kind).toBe('demo');
  });

  it('computes cross rates via USD with 10 significant digits', () => {
    expect(crossRate(DEMO_RATES, 'USD', 'USD')).toBe('1');
    expect(crossRate(DEMO_RATES, 'EUR', 'GBP')).toBe(String(Number((0.745 / 0.86).toPrecision(10))));
    expect(Number(crossRate(DEMO_RATES, 'EUR', 'ALL'))).toBeCloseTo(83.5 / 0.86, 6);
    expect(crossRate(null, 'EUR', 'GBP')).toBeNull();
    expect(crossRate({ ...DEMO_RATES, rates: { USD: '1' } }, 'USD', 'EUR')).toBeNull();
  });

  it('converts for display only when a rate exists', () => {
    expect(convertForDisplay(10_000, 'USD', 'JPY', DEMO_RATES, 2, 0)).toBe(14_750);
    expect(convertForDisplay(10_000, 'USD', 'USD', null, 2, 2)).toBe(10_000);
    expect(convertForDisplay(10_000, 'USD', 'EUR', null, 2, 2)).toBeNull();
  });

  it('accepts only well-formed live payloads', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const good = { result: 'success', base_code: 'USD', time_last_update_unix: 1773100800, rates: { USD: 1, EUR: 0.91, GBP: 0.78, JPY: 149.2, CHF: 0.88, ALL: 90.1, TRY: 38.5, CAD: 1.36, AUD: 1.52 } };
    const snap = parseLiveRates(good, now);
    expect(snap?.kind).toBe('live');
    expect(snap?.rates.EUR).toBe('0.91');
    expect(snap?.fetchedAt).toBe(now.toISOString());
    expect(parseLiveRates({ ...good, result: 'error' }, now)).toBeNull();
    expect(parseLiveRates({ ...good, base_code: 'EUR' }, now)).toBeNull();
    expect(parseLiveRates({ ...good, rates: { EUR: -1, GBP: 'x' } }, now)).toBeNull();
    expect(parseLiveRates('nope', now)).toBeNull();
    expect(parseLiveRates({ ...good, time_last_update_unix: 'yesterday' }, now)).toBeNull();
  });

  it('never presents demo or stale rates as live', () => {
    const now = new Date('2026-03-10T12:00:00Z');
    expect(describeRates(DEMO_RATES, now, true, label).kind).toBe('demo');
    const live = { ...DEMO_RATES, kind: 'live' as const, provider: 'Test', publishedAt: '2026-03-10T00:00:00Z' };
    expect(describeRates(live, now, true, label).kind).toBe('live');
    expect(describeRates(live, now, true, label).detail).toMatch(/Indicative/);
    expect(describeRates(live, now, false, label).kind).toBe('cached');
    expect(describeRates({ ...live, publishedAt: '2026-03-07T00:00:00Z' }, now, true, label).kind).toBe('stale');
    expect(activeSnapshot(null, true, false)).toBe(DEMO_RATES);
    expect(activeSnapshot(live, false, true)).toBe(DEMO_RATES);
    expect(activeSnapshot(live, true, false).kind).toBe('cached');
  });

  it('formats rates by magnitude', () => {
    expect(formatRate('147.5')).toBe('147.50');
    expect(formatRate('0.86')).toBe('0.86');
    expect(formatRate('1.1627906977')).toBe('1.1628');
    expect(formatRate(null)).toBe('—');
  });
});
