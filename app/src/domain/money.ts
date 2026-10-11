import Big from 'big.js';
import { CURRENCIES, type CurrencyCode } from './currency';

/**
 * Money is always handled as integer *minor units* (cents, pence, yen …).
 * Floating point is never used for monetary arithmetic; multiplication by
 * rates/percentages goes through BigInt or big.js with explicit rounding.
 */

/** Largest amount accepted for a single simulated operation (major units). */
export const MAX_OPERATION_MAJOR = 999_999_999;
/** Hard ceiling for any stored balance (minor units) — well inside Number.MAX_SAFE_INTEGER. */
export const MAX_BALANCE_MINOR = 900_000_000_000_000;

export function pow10(n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= 10;
  return r;
}

export function isMinor(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** 123450, 2 → "1234.50" ; -5, 2 → "-0.05" ; 120, 0 → "120" */
export function minorToDecimalString(minor: number, decimals: number): string {
  if (!isMinor(minor)) throw new Error('minorToDecimalString: not a safe integer');
  const neg = minor < 0;
  const abs = Math.abs(minor);
  if (decimals === 0) return (neg ? '-' : '') + String(abs);
  const s = String(abs).padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals);
  return (neg ? '-' : '') + int + '.' + frac;
}

export type AmountError = 'empty' | 'invalid' | 'negative' | 'zero' | 'too_many_decimals' | 'too_large';
export type AmountResult = { ok: true; minor: number } | { ok: false; error: AmountError };

export const AMOUNT_ERROR_TEXT: Record<AmountError, string> = {
  empty: 'Enter an amount',
  invalid: 'That is not a valid amount',
  negative: 'Amount cannot be negative',
  zero: 'Amount must be greater than zero',
  too_many_decimals: 'Too many decimal places for this currency',
  too_large: 'Amount is too large for the simulator',
};

/** Normalises user typed text ("1.234,56", "1,234.56", "12,5", " 99 ") into "1234.56"-style. */
export function normalizeAmountText(raw: string): string {
  let s = String(raw ?? '')
    .trim()
    .replace(/[\s'_\u00A0\u202F\u2019]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) s = parts[0] + '.' + parts[1];
    else s = s.replace(/,/g, '');
  }
  return s;
}

/**
 * Strictly parses a user-entered, *unsigned* amount into minor units.
 * Rejects empty, negative, non-numeric, over-precise and oversized values.
 */
export function parseAmount(
  raw: string,
  decimals: number,
  opts: { allowZero?: boolean; maxMajor?: number } = {},
): AmountResult {
  if (raw === undefined || raw === null) return { ok: false, error: 'empty' };
  let s = normalizeAmountText(raw);
  if (s === '') return { ok: false, error: 'empty' };
  if (s.startsWith('-') || s.startsWith('\u2212')) return { ok: false, error: 'negative' };
  if (s.startsWith('+')) s = s.slice(1);
  if (s === '.' || !/^\d*(\.\d*)?$/.test(s)) return { ok: false, error: 'invalid' };
  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  let fracPart = dot === -1 ? '' : s.slice(dot + 1);
  if (fracPart.length > decimals) {
    const trimmed = fracPart.replace(/0+$/, '');
    if (trimmed.length > decimals) return { ok: false, error: 'too_many_decimals' };
    fracPart = trimmed;
  }
  const intDigits = intPart.replace(/^0+(?=\d)/, '') || '0';
  if (intDigits.length > 12) return { ok: false, error: 'too_large' };
  const fracDigits = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const minor = Number(intDigits) * pow10(decimals) + (decimals > 0 ? Number(fracDigits) : 0);
  if (!Number.isSafeInteger(minor)) return { ok: false, error: 'too_large' };
  const maxMajor = opts.maxMajor ?? MAX_OPERATION_MAJOR;
  if (minor > maxMajor * pow10(decimals)) return { ok: false, error: 'too_large' };
  if (minor === 0 && !opts.allowZero) return { ok: false, error: 'zero' };
  return { ok: true, minor };
}

/** Parses an amount that may carry a sign (used for balance editing). */
export function parseSignedAmount(raw: string, decimals: number, opts: { maxMajor?: number } = {}): AmountResult {
  const s = String(raw ?? '').trim();
  const negative = s.startsWith('-') || s.startsWith('\u2212');
  const body = negative ? s.slice(1) : s;
  const r = parseAmount(body, decimals, { allowZero: true, maxMajor: opts.maxMajor });
  if (!r.ok) return r;
  return { ok: true, minor: negative ? -r.minor : r.minor };
}

/* ------------------------------------------------------------------ */
/* Keypad                                                              */
/* ------------------------------------------------------------------ */

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back' | 'clear';

/**
 * Pure reducer for the custom amount keypad. It never produces an invalid
 * intermediate string: no double separators, no leading zeros and no more
 * decimals than the currency supports.
 */
export function keypadInput(current: string, key: KeypadKey | string, decimals: number, maxIntDigits = 9): string {
  if (key === 'clear') return '';
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') {
    if (decimals === 0 || current.includes('.')) return current;
    return current === '' ? '0.' : current + '.';
  }
  if (!/^\d$/.test(key)) return current;
  const dot = current.indexOf('.');
  if (dot !== -1) {
    const frac = current.slice(dot + 1);
    if (frac.length >= decimals) return current;
    return current + key;
  }
  if (current === '0') return key === '0' ? current : key;
  if (current.length >= maxIntDigits) return current;
  return current + key;
}

/** Converts minor units into the keypad's editable text form ("1250.5" style, trimmed). */
export function minorToKeypadText(minor: number, decimals: number): string {
  if (minor <= 0) return '';
  const s = minorToDecimalString(minor, decimals);
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

/* ------------------------------------------------------------------ */
/* Fees, conversion, percentages                                       */
/* ------------------------------------------------------------------ */

export interface FeeSchedule {
  /** Percentage component in basis points (1 bp = 0.01 %). */
  bps: number;
  /** Fixed component in minor units. */
  fixed: number;
  /** Minimum total fee in minor units (0 = none). */
  min: number;
  /** Maximum total fee in minor units (0 = none). */
  max: number;
}

export const NO_FEE: FeeSchedule = { bps: 0, fixed: 0, min: 0, max: 0 };

/** Fee = round_half_up(amount × bps / 10 000) + fixed, clamped to [min, max]. */
export function computeFee(amount: number, schedule: FeeSchedule): number {
  if (!isMinor(amount) || amount <= 0) return 0;
  if (schedule.bps === 0 && schedule.fixed === 0) return 0;
  const pct = (BigInt(amount) * BigInt(Math.round(schedule.bps)) + 5000n) / 10000n;
  let fee = Number(pct) + schedule.fixed;
  if (schedule.min > 0 && fee < schedule.min) fee = schedule.min;
  if (schedule.max > 0 && fee > schedule.max) fee = schedule.max;
  return Math.max(0, fee);
}

/**
 * Converts an amount between currencies with a decimal rate expressed as
 * "units of target per one unit of source". Rounds half-up to the target's
 * minor unit. Throws on invalid rates.
 */
export function convertMinor(amountMinor: number, fromDecimals: number, toDecimals: number, rate: string | number): number {
  if (!isMinor(amountMinor)) throw new Error('convertMinor: amount must be integer minor units');
  let r: Big;
  try {
    r = new Big(rate);
  } catch {
    throw new Error('convertMinor: invalid rate');
  }
  if (r.lte(0)) throw new Error('convertMinor: rate must be positive');
  const target = new Big(amountMinor).div(pow10(fromDecimals)).times(r).times(pow10(toDecimals)).round(0, Big.roundHalfUp);
  const n = Number(target.toString());
  if (!Number.isSafeInteger(n)) throw new Error('convertMinor: result out of range');
  return n;
}

/** ratio in percent with one decimal, safe for zero denominators. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export type SignMode = 'auto' | 'always' | 'exceptZero' | 'never';

export interface MoneyFormatOptions {
  locale?: string;
  sign?: SignMode;
  compact?: boolean;
  hidden?: boolean;
  /** Show the ISO code instead of the symbol. */
  code?: boolean;
}

const nfCache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, currency: CurrencyCode, opts: { sign: SignMode; compact: boolean; decimals: number }) {
  const key = `${locale}|${currency}|${opts.sign}|${opts.compact}|${opts.decimals}`;
  let nf = nfCache.get(key);
  if (!nf) {
    const signDisplay = opts.sign === 'never' ? 'never' : opts.sign;
    try {
      nf = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: opts.compact ? 0 : opts.decimals,
        maximumFractionDigits: opts.compact ? 1 : opts.decimals,
        notation: opts.compact ? 'compact' : 'standard',
        signDisplay: signDisplay as Intl.NumberFormatOptions['signDisplay'],
      });
    } catch {
      nf = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: opts.compact ? 0 : opts.decimals,
        maximumFractionDigits: opts.compact ? 1 : opts.decimals,
      });
    }
    nfCache.set(key, nf);
  }
  return nf;
}

export interface MoneyParts {
  sign: string;
  symbol: string;
  symbolFirst: boolean;
  integer: string;
  decimalSeparator: string;
  fraction: string;
  /** Full string as rendered. */
  text: string;
}

const MINUS = '\u2212';

/** Structured formatting so the UI can style integer/fraction separately. */
export function formatMoneyParts(minor: number, currency: CurrencyCode, opts: MoneyFormatOptions = {}): MoneyParts {
  const info = CURRENCIES[currency];
  const locale = opts.locale ?? 'en-US';
  const sign = opts.sign ?? 'auto';
  const nf = numberFormat(locale, currency, { sign, compact: !!opts.compact, decimals: info.decimals });
  const value = Number(minorToDecimalString(minor, info.decimals));
  const parts = nf.formatToParts(value);
  const symbol = opts.code ? currency : info.symbol;
  let signText = '';
  let integer = '';
  let decimalSeparator = '';
  let fraction = '';
  let symbolFirst = true;
  let seenNumber = false;
  let text = '';
  for (const p of parts) {
    switch (p.type) {
      case 'minusSign':
        signText = MINUS;
        text += MINUS;
        break;
      case 'plusSign':
        signText = '+';
        text += '+';
        break;
      case 'currency':
        symbolFirst = !seenNumber;
        text += symbol;
        break;
      case 'integer':
      case 'group':
        seenNumber = true;
        integer += p.value;
        text += p.value;
        break;
      case 'decimal':
        decimalSeparator = p.value;
        text += p.value;
        break;
      case 'fraction':
        fraction += p.value;
        text += p.value;
        break;
      case 'compact':
        seenNumber = true;
        fraction += p.value;
        text += p.value;
        break;
      case 'literal':
        text += p.value;
        break;
      default:
        text += p.value;
    }
  }
  // Letter-like symbols (CHF, kr, zł, L) keep a no-break space; glyph symbols ($, €, ₺) sit tight.
  if (/\p{L}$/u.test(symbol)) {
    text = text.replace(new RegExp(`${escapeRegExp(symbol)}(?=[\\d${MINUS}+])`), `${symbol}\u00A0`);
  } else if (symbolFirst) {
    text = text.replace(new RegExp(`${escapeRegExp(symbol)}[\\s\u00A0]+`), symbol);
  }
  return { sign: signText, symbol, symbolFirst, integer, decimalSeparator, fraction, text };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const HIDDEN_AMOUNT = '\u2022\u2022\u2022\u2022\u2022\u2022';

export function formatMoney(minor: number, currency: CurrencyCode, opts: MoneyFormatOptions = {}): string {
  if (opts.hidden) return `${CURRENCIES[currency].symbol}${CURRENCIES[currency].symbol.length > 1 ? '\u00A0' : ''}${HIDDEN_AMOUNT}`;
  return formatMoneyParts(minor, currency, opts).text;
}

/** Formats what the user is typing on the keypad ("1250.5" → "$1,250.5"). */
export function formatTypedAmount(text: string, currency: CurrencyCode, locale = 'en-US'): string {
  const info = CURRENCIES[currency];
  const dot = text.indexOf('.');
  const intText = (dot === -1 ? text : text.slice(0, dot)) || '0';
  const frac = dot === -1 ? null : text.slice(dot + 1);
  const intMinor = Number(intText) * pow10(info.decimals);
  const parts = formatMoneyParts(intMinor, currency, { locale });
  const sep = parts.decimalSeparator || (locale.startsWith('en') ? '.' : ',');
  const number = parts.integer + (frac !== null ? sep + frac : '');
  if (parts.symbolFirst) return `${parts.symbol}${parts.symbol.length > 1 ? '\u00A0' : ''}${number}`;
  return `${number}\u00A0${parts.symbol}`;
}

const plainNfCache = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: number, locale = 'en-US', minFrac = 0, maxFrac = 2): string {
  const key = `${locale}|${minFrac}|${maxFrac}`;
  let nf = plainNfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
    plainNfCache.set(key, nf);
  }
  return nf.format(value);
}

export function formatPercent(value: number | null, locale = 'en-US', digits = 1, signed = true): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const s = formatNumber(Math.abs(value), locale, digits, digits);
  const sign = value > 0 ? (signed ? '+' : '') : value < 0 ? MINUS : '';
  return `${sign}${s}%`;
}

/** Converts minor units to a JS number of major units — for charts only, never for accounting. */
export function minorToMajorNumber(minor: number, currency: CurrencyCode): number {
  return Number(minorToDecimalString(minor, CURRENCIES[currency].decimals));
}

export function majorStep(currency: CurrencyCode): number {
  return pow10(CURRENCIES[currency].decimals);
}
