import { describe, expect, it } from 'vitest';
import type { CurrencyCode } from '../src/domain/currency';
import { sequentialIds } from '../src/domain/ids';
import { rebuildSnapshots, verifyLedger } from '../src/domain/ledger';
import { createInitialState, localBalance, PRESETS, usernameFrom } from '../src/domain/presets';
import { loadState } from '../src/domain/schema';
import type { PresetId } from '../src/domain/types';

const NOW = new Date('2026-10-11T14:30:00');

function make(preset: PresetId, currency: CurrencyCode = 'USD', startingBalance: number | null = null, sample = true) {
  return createInitialState({
    preset,
    displayName: 'Alex Morgan',
    currency,
    theme: 'dark',
    startingBalance,
    cardStyle: 'obsidian',
    sampleTransactions: sample,
    marketDemo: true,
    now: NOW,
    seed: 42,
    id: sequentialIds('p'),
    walletId: 'VX-DEMO-TEST-0001',
  });
}

describe('setup presets', () => {
  const cases: Array<[PresetId, CurrencyCode]> = [
    ['minimal', 'USD'],
    ['everyday', 'USD'],
    ['everyday', 'EUR'],
    ['everyday', 'JPY'],
    ['everyday', 'ALL'],
    ['premium', 'GBP'],
    ['premium', 'TRY'],
    ['investor', 'USD'],
    ['investor', 'CHF'],
    ['sandbox', 'USD'],
  ];

  it.each(cases)('%s / %s produces a consistent ledger with sane history', (preset, currency) => {
    const s = make(preset, currency);
    expect(verifyLedger(s).ok).toBe(true);
    // Snapshots match a full replay and no asset account ever dipped below zero.
    const replay = rebuildSnapshots(s);
    expect(replay.state.transactions).toEqual(s.transactions);
    for (const a of s.accounts) {
      if (a.kind === 'credit') {
        expect(replay.maxBalance.get(a.id)).toBeLessThanOrEqual(0);
        expect(-(replay.minBalance.get(a.id) ?? 0)).toBeLessThanOrEqual(a.credit!.limit);
      } else {
        expect(replay.minBalance.get(a.id)).toBeGreaterThanOrEqual(0);
      }
    }
    // Every card points at an existing account and shows only four digits.
    for (const c of s.cards) {
      expect(s.accounts.some((a) => a.id === c.accountId)).toBe(true);
      expect(c.displayDigits).toMatch(/^\d{4}$/);
    }
    // Default card and account exist.
    expect(s.accounts.some((a) => a.id === s.settings.defaultAccountId)).toBe(true);
    if (s.cards.length) expect(s.cards.some((c) => c.id === s.settings.defaultCardId)).toBe(true);
    // Nothing happens in the future.
    for (const t of s.transactions) expect(new Date(t.createdAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
    // The state survives its own schema validation unchanged.
    const loaded = loadState(JSON.parse(JSON.stringify(s)));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.repaired).toBe(false);
  });

  it('lands the main wallet exactly on the preset or chosen balance', () => {
    for (const p of PRESETS) {
      const s = make(p.id, 'EUR');
      expect(s.accounts.find((a) => a.id === 'acc_main')?.balance).toBe(localBalance(p.mainUsd, 'EUR'));
    }
    expect(make('everyday', 'USD', 123_45).accounts.find((a) => a.id === 'acc_main')?.balance).toBe(12_345);
    expect(make('everyday', 'USD', 0).accounts.find((a) => a.id === 'acc_main')?.balance).toBe(0);
    expect(make('investor', 'USD', 99_999_999).accounts.find((a) => a.id === 'acc_main')?.balance).toBe(99_999_999);
  });

  it('generates realistic sample activity only when asked', () => {
    const withSample = make('everyday');
    const without = make('everyday', 'USD', null, false);
    expect(withSample.transactions.length).toBeGreaterThan(80);
    expect(without.transactions.every((t) => t.subtype === 'opening')).toBe(true);
    expect(withSample.requests.some((r) => r.status === 'pending')).toBe(true);
    expect(withSample.transactions.some((t) => t.status === 'pending')).toBe(true);
    expect(withSample.transactions.some((t) => t.type === 'refund')).toBe(true);
    expect(withSample.transactions.some((t) => t.type === 'exchange')).toBe(true);
    expect(withSample.transactions.some((t) => t.type === 'credit_payment')).toBe(true);
    expect(withSample.goals[0].saved).toBeGreaterThan(0);
    expect(withSample.notifications.length).toBe(1);
  });

  it('builds a portfolio with realized gains for the investor preset', () => {
    const s = make('investor');
    expect(Object.keys(s.markets.positions).length).toBeGreaterThanOrEqual(10);
    expect(s.markets.orders.some((o) => o.side === 'sell')).toBe(true);
    expect(s.markets.realizedPnl).not.toBe(0);
  });

  it('is reproducible for the same seed', () => {
    expect(make('everyday')).toEqual(make('everyday'));
  });

  it('creates a clean sandbox', () => {
    const s = make('sandbox', 'USD', 0);
    expect(s.transactions.length).toBe(0);
    expect(s.contacts.length).toBe(0);
    expect(s.accounts.find((a) => a.id === 'acc_main')?.balance).toBe(0);
  });

  it('derives usernames safely', () => {
    expect(usernameFrom('Élodie Brûlé')).toBe('elodie.brule');
    expect(usernameFrom('李')).toBe('veltrix.user');
    expect(usernameFrom('  Mary-Jane  O’Neil ')).toBe('mary.jane.o.neil');
  });
});
