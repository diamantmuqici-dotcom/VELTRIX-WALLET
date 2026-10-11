import { describe, expect, it } from 'vitest';
import {
  applyCreditEdit,
  archiveAccount,
  createAccount,
  createCard,
  createContact,
  creditFigures,
  deleteCard,
  deleteContact,
  minimumDue,
  moveAccount,
  moveCard,
  resolveCreditEdit,
  setCardStatus,
  sortedCards,
  updateAccount,
  updateCard,
  updateContact,
} from '../src/domain/ops/entities';
import { transfer } from '../src/domain/ops/payments';
import { balance, CARD_DEFAULTS, expectConsistent, fixture, ok } from './helpers';

describe('accounts', () => {
  it('creates accounts with an opening ledger entry', () => {
    const { state, ctx } = fixture();
    const r = ok(createAccount(state, { kind: 'savings', name: 'Holiday pot 🏝️', currency: 'GBP', opening: 12_345, color: '#F5A524' }, ctx));
    expect(r.account.balance).toBe(12_345);
    const opening = r.state.transactions[r.state.transactions.length - 1];
    expect(opening.subtype).toBe('opening');
    expect(opening.accountId).toBe(r.account.id);
    expectConsistent(r.state);
  });

  it('validates names, currencies and credit parameters', () => {
    const { state, ctx } = fixture();
    expect(createAccount(state, { kind: 'savings', name: ' ', currency: 'USD', opening: 0, color: '#000000' }, ctx).ok).toBe(false);
    expect(createAccount(state, { kind: 'savings', name: 'X', currency: 'XXX' as never, opening: 0, color: '#000000' }, ctx).ok).toBe(false);
    expect(createAccount(state, { kind: 'savings', name: 'X', currency: 'USD', opening: -1, color: '#000000' }, ctx).ok).toBe(false);
    expect(
      createAccount(state, { kind: 'credit', name: 'C', currency: 'USD', opening: 5_000, color: '#000000', credit: { limit: 1_000, statementBalance: 0, dueDate: '2026-04-01' } }, ctx).ok,
    ).toBe(false);
    expect(
      createAccount(state, { kind: 'credit', name: 'C', currency: 'USD', opening: 0, color: '#000000', credit: { limit: 1_000, statementBalance: 0, dueDate: '2026-02-30' } }, ctx).ok,
    ).toBe(false);
  });

  it('renames, recolors, hides and reorders', () => {
    const { state } = fixture();
    const r = ok(updateAccount(state, 'acc_savings', { name: 'Rainy day', showOnDashboard: false, color: '#10B981' }));
    expect(r.account.name).toBe('Rainy day');
    expect(r.account.showOnDashboard).toBe(false);
    expect(updateAccount(state, 'acc_savings', { name: '' }).ok).toBe(false);
    const order = (s: typeof state) => s.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order).map((a) => a.id);
    const moved = moveAccount(state, 'acc_checking', -1);
    expect(order(moved).indexOf('acc_checking')).toBe(order(state).indexOf('acc_checking') - 1);
    expect(moveAccount(state, order(state)[0], -1)).toBe(state);
  });

  it('archives only empty accounts without cards, never the main wallet', () => {
    const { state, ctx } = fixture();
    expect(archiveAccount(state, 'acc_main')).toMatchObject({ ok: false, error: 'cannot_archive' });
    expect(archiveAccount(state, 'acc_checking')).toMatchObject({ ok: false, error: 'cannot_archive' });
    expect(archiveAccount(state, 'acc_credit')).toMatchObject({ ok: false, error: 'cannot_archive' });
    const ok1 = ok(archiveAccount(state, 'acc_savings'));
    expect(ok1.state.accounts.find((a) => a.id === 'acc_savings')?.archived).toBe(true);
    expect(transfer(ok1.state, { fromId: 'acc_main', toId: 'acc_savings', amount: 100 }, ctx)).toMatchObject({ ok: false, error: 'account_archived' });
  });
});

describe('simulated credit account', () => {
  it('derives available, used and utilization consistently', () => {
    const { state } = fixture();
    const f = creditFigures(state.accounts.find((a) => a.id === 'acc_credit')!);
    expect(f).toMatchObject({ limit: 200_000, used: 30_000, available: 170_000, utilization: 15, statementBalance: 25_000 });
    expect(f.minimumDue).toBe(2_500);
    expect(minimumDue(0)).toBe(0);
    expect(minimumDue(1_000)).toBe(1_000);
    expect(minimumDue(1_000_000)).toBe(20_000);
  });

  it('resolves edits from whichever field the user typed', () => {
    const base = { limit: 100_000, statementBalance: 0, dueDate: '2026-04-01' };
    expect(resolveCreditEdit({ ...base, driver: 'used', used: 25_000 })).toMatchObject({ ok: true, used: 25_000 });
    expect(resolveCreditEdit({ ...base, driver: 'available', available: 60_000 })).toMatchObject({ ok: true, used: 40_000 });
    expect(resolveCreditEdit({ ...base, driver: 'utilization', utilization: 12.5 })).toMatchObject({ ok: true, used: 12_500 });
    expect(resolveCreditEdit({ ...base, driver: 'used', used: 100_001 })).toMatchObject({ ok: false });
    expect(resolveCreditEdit({ ...base, driver: 'available', available: 100_001 })).toMatchObject({ ok: false });
    expect(resolveCreditEdit({ ...base, driver: 'utilization', utilization: 101 })).toMatchObject({ ok: false });
    expect(resolveCreditEdit({ ...base, limit: 0, driver: 'used', used: 0 })).toMatchObject({ ok: false });
    expect(resolveCreditEdit({ ...base, statementBalance: 100_001, driver: 'used', used: 0 })).toMatchObject({ ok: false });
    expect(resolveCreditEdit({ ...base, dueDate: 'soon', driver: 'used', used: 0 })).toMatchObject({ ok: false });
  });

  it('records a change of used credit as a ledger adjustment', () => {
    const { state, ctx } = fixture();
    const r = ok(applyCreditEdit(state, 'acc_credit', { limit: 300_000, driver: 'utilization', utilization: 50, statementBalance: 40_000, dueDate: '2026-04-15' }, ctx));
    const acc = r.state.accounts.find((a) => a.id === 'acc_credit')!;
    expect(acc.balance).toBe(-150_000);
    expect(acc.credit).toEqual({ limit: 300_000, statementBalance: 40_000, dueDate: '2026-04-15' });
    const last = r.state.transactions[r.state.transactions.length - 1];
    expect(last.type).toBe('adjustment');
    expect(last.amount).toBe(120_000);
    expectConsistent(r.state);
    // A lower limit than what is used is rejected.
    expect(applyCreditEdit(r.state, 'acc_credit', { limit: 100_000, driver: 'used', used: 150_000, statementBalance: 0, dueDate: '2026-04-15' }, ctx).ok).toBe(false);
  });
});

describe('demo cards', () => {
  it('creates, customizes, freezes, reorders and deletes cards', () => {
    const { state, ctx } = fixture();
    const c = ok(createCard(state, { ...CARD_DEFAULTS, nickname: 'Neon night', style: 'neon', accountId: 'acc_checking', displayDigits: '0007' }, ctx));
    expect(c.card.status).toBe('active');
    const u = ok(updateCard(c.state, c.card.id, { style: 'custom', customFrom: '#123456', customTo: '#654321', pattern: 'mesh', nickname: 'Custom' }));
    expect(u.card.style).toBe('custom');
    const f = ok(setCardStatus(u.state, c.card.id, 'frozen'));
    expect(f.card.status).toBe('frozen');
    const ordered = sortedCards(f.state).map((x) => x.id);
    const moved = moveCard(f.state, c.card.id, -10);
    expect(sortedCards(moved)[0].id).toBe(c.card.id);
    expect(sortedCards(moved).length).toBe(ordered.length);
    const d = ok(deleteCard(moved, c.card.id));
    expect(d.state.cards.some((x) => x.id === c.card.id)).toBe(false);
  });

  it('never accepts full card numbers or mismatched account types', () => {
    const { state, ctx } = fixture();
    expect(createCard(state, { ...CARD_DEFAULTS, displayDigits: '4242424242424242', accountId: 'acc_main' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, displayDigits: '12a4', accountId: 'acc_main' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, expiry: '13/30', accountId: 'acc_main' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, kind: 'credit', accountId: 'acc_main' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, kind: 'debit', accountId: 'acc_credit' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, accountId: 'acc_invest' }, ctx).ok).toBe(false);
    expect(createCard(state, { ...CARD_DEFAULTS, accent: 'red', accountId: 'acc_main' }, ctx).ok).toBe(false);
    // Card objects carry no CVV / PAN fields at all.
    const c = ok(createCard(state, { ...CARD_DEFAULTS, accountId: 'acc_main' }, ctx)).card as unknown as Record<string, unknown>;
    expect(Object.keys(c).some((k) => /cvv|cvc|pan|number/i.test(k))).toBe(false);
  });

  it('reassigns the default card when it is deleted', () => {
    const { state } = fixture();
    const first = state.settings.defaultCardId;
    expect(first).toBe(state.cards[0].id);
    const d = ok(deleteCard(state, first));
    expect(d.state.settings.defaultCardId).toBe(state.cards[1].id);
    const d2 = ok(deleteCard(d.state, state.cards[1].id));
    expect(d2.state.settings.defaultCardId).toBe('');
  });

  it('keeps history after a card is deleted', () => {
    const { state } = fixture();
    expect(balance(ok(deleteCard(state, state.cards[0].id)).state, 'acc_main')).toBe(100_000);
  });
});

describe('contacts', () => {
  it('creates, edits and deletes fictional contacts with unique usernames', () => {
    const { state, ctx } = fixture();
    const c = ok(createContact(state, { name: 'Noah Kim', username: '@NoahK', identifier: '+1 555 0100', color: '#2DD4A7', note: 'Roommate', favorite: false }, ctx));
    expect(c.contact.username).toBe('noahk');
    expect(createContact(c.state, { name: 'Other', username: 'noahk', identifier: '', color: '#2DD4A7', note: '', favorite: false }, ctx)).toMatchObject({ ok: false, error: 'duplicate_username' });
    expect(createContact(c.state, { name: 'Other', username: 'a!', identifier: '', color: '#2DD4A7', note: '', favorite: false }, ctx).ok).toBe(false);
    expect(createContact(c.state, { name: 'Other', username: 'other', identifier: 'not-an-id', color: '#2DD4A7', note: '', favorite: false }, ctx).ok).toBe(false);
    const u = ok(updateContact(c.state, c.contact.id, { name: 'Noah K.', username: 'noahk', identifier: '', color: '#F45B69', note: '', favorite: true }));
    expect(u.contact.favorite).toBe(true);
    expect(ok(deleteContact(u.state, c.contact.id)).state.contacts.some((x) => x.id === c.contact.id)).toBe(false);
  });
});
