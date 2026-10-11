import { describe, expect, it } from 'vitest';
import {
  computeFee,
  convertMinor,
  formatMoney,
  formatTypedAmount,
  keypadInput,
  minorToDecimalString,
  minorToKeypadText,
  normalizeAmountText,
  parseAmount,
  parseSignedAmount,
  percentChange,
} from '../src/domain/money';

describe('amount parsing (integer minor units)', () => {
  it('parses plain and localized input', () => {
    expect(parseAmount('12.34', 2)).toEqual({ ok: true, minor: 1234 });
    expect(parseAmount('1,234.56', 2)).toEqual({ ok: true, minor: 123456 });
    expect(parseAmount('1.234,56', 2)).toEqual({ ok: true, minor: 123456 });
    expect(parseAmount('12,5', 2)).toEqual({ ok: true, minor: 1250 });
    expect(parseAmount(' 99 ', 2)).toEqual({ ok: true, minor: 9900 });
    expect(parseAmount('0.1', 2)).toEqual({ ok: true, minor: 10 });
    expect(parseAmount('1500', 0)).toEqual({ ok: true, minor: 1500 });
  });

  it('never uses binary floating point (0.1 + 0.2 style values stay exact)', () => {
    const a = parseAmount('0.10', 2);
    const b = parseAmount('0.20', 2);
    expect(a.ok && b.ok && a.minor + b.minor).toBe(30);
    expect(parseAmount('19.99', 2)).toEqual({ ok: true, minor: 1999 });
    expect(parseAmount('1.005', 3)).toEqual({ ok: true, minor: 1005 });
  });

  it('rejects invalid input', () => {
    expect(parseAmount('', 2)).toEqual({ ok: false, error: 'empty' });
    expect(parseAmount('-5', 2)).toEqual({ ok: false, error: 'negative' });
    expect(parseAmount('abc', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('1.2.3', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('12.345', 2)).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseAmount('1.5', 0)).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(parseAmount('0', 2)).toEqual({ ok: false, error: 'zero' });
    expect(parseAmount('1e5', 2)).toEqual({ ok: false, error: 'invalid' });
    expect(parseAmount('9999999999999', 2)).toEqual({ ok: false, error: 'too_large' });
    expect(parseAmount('Infinity', 2)).toEqual({ ok: false, error: 'invalid' });
  });

  it('accepts trailing zeros beyond the currency precision', () => {
    expect(parseAmount('12.300', 2)).toEqual({ ok: true, minor: 1230 });
    expect(parseAmount('7.0', 0)).toEqual({ ok: true, minor: 7 });
  });

  it('parses signed amounts for balance edits', () => {
    expect(parseSignedAmount('-12.50', 2)).toEqual({ ok: true, minor: -1250 });
    expect(parseSignedAmount('\u221212.50', 2)).toEqual({ ok: true, minor: -1250 });
    expect(parseSignedAmount('0', 2)).toEqual({ ok: true, minor: 0 });
  });

  it('normalizes separators', () => {
    expect(normalizeAmountText("1'234.50")).toBe('1234.50');
    expect(normalizeAmountText('1 234,50')).toBe('1234.50');
    expect(normalizeAmountText('1,234')).toBe('1234');
  });

  it('round-trips minor units to decimal strings', () => {
    expect(minorToDecimalString(123450, 2)).toBe('1234.50');
    expect(minorToDecimalString(-5, 2)).toBe('-0.05');
    expect(minorToDecimalString(120, 0)).toBe('120');
    expect(minorToKeypadText(125050, 2)).toBe('1250.5');
    expect(minorToKeypadText(100, 2)).toBe('1');
  });
});

describe('keypad reducer', () => {
  const type = (keys: string[], decimals = 2) => keys.reduce((s, k) => keypadInput(s, k, decimals), '');
  it('builds decimal amounts safely', () => {
    expect(type(['1', '2', '.', '5', '0', '7'])).toBe('12.50');
    expect(type(['.', '5'])).toBe('0.5');
    expect(type(['0', '0', '7'])).toBe('7');
    expect(type(['1', '.', '.', '2'])).toBe('1.2');
    expect(type(['5', '.', '5'], 0)).toBe('55');
    expect(type(['9', '9', 'back'])).toBe('9');
    expect(type(['9', 'clear'])).toBe('');
  });
  it('caps integer digits', () => {
    expect(type(Array(15).fill('9'))).toBe('999999999');
  });
});

describe('fees', () => {
  it('computes percentage + fixed with clamping, rounding half-up', () => {
    expect(computeFee(10_000, { bps: 150, fixed: 0, min: 0, max: 0 })).toBe(150);
    expect(computeFee(333, { bps: 150, fixed: 0, min: 0, max: 0 })).toBe(5); // 4.995 → 5
    expect(computeFee(100, { bps: 150, fixed: 0, min: 25, max: 0 })).toBe(25);
    expect(computeFee(10_000_000, { bps: 150, fixed: 0, min: 25, max: 1500 })).toBe(1500);
    expect(computeFee(1000, { bps: 0, fixed: 99, min: 0, max: 0 })).toBe(99);
    expect(computeFee(0, { bps: 150, fixed: 10, min: 0, max: 0 })).toBe(0);
    expect(computeFee(1000, { bps: 0, fixed: 0, min: 50, max: 0 })).toBe(0);
  });
  it('is exact for very large amounts', () => {
    expect(computeFee(899_999_999_999_999, { bps: 1, fixed: 0, min: 0, max: 0 })).toBe(90_000_000_000);
  });
});

describe('currency conversion', () => {
  it('converts between precisions with half-up rounding', () => {
    expect(convertMinor(10_000, 2, 2, '0.86')).toBe(8_600);
    expect(convertMinor(10_000, 2, 0, '147.5')).toBe(14_750);
    expect(convertMinor(1, 2, 2, '0.5')).toBe(1); // 0.005 → 0.01
    expect(convertMinor(14_750, 0, 2, '0.0067796610')).toBe(10_000);
  });
  it('rejects invalid rates', () => {
    expect(() => convertMinor(100, 2, 2, '0')).toThrow();
    expect(() => convertMinor(100, 2, 2, 'abc')).toThrow();
    expect(() => convertMinor(1.5, 2, 2, '1')).toThrow();
  });
});

describe('formatting', () => {
  it('formats with app symbols and a true minus sign', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
    expect(formatMoney(-500, 'USD')).toBe('\u2212$5.00');
    expect(formatMoney(150000, 'JPY')).toBe('¥150,000');
    expect(formatMoney(1050, 'CHF')).toBe('CHF\u00A010.50');
    expect(formatMoney(1050, 'EUR', { locale: 'de-DE' })).toMatch(/^10,50\s?€$/);
    expect(formatMoney(1050, 'USD', { sign: 'always' })).toBe('+$10.50');
    expect(formatMoney(1050, 'USD', { hidden: true })).not.toContain('10');
  });
  it('formats typed keypad text', () => {
    expect(formatTypedAmount('1250.5', 'USD')).toBe('$1,250.5');
    expect(formatTypedAmount('', 'USD')).toBe('$0');
  });
  it('computes percent change safely', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(10, 0)).toBeNull();
  });
});
