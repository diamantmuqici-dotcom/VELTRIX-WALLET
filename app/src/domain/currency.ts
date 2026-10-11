/**
 * Currency catalogue for the simulator.
 *
 * `decimals` is the ISO 4217 minor-unit exponent and is used both for storage
 * (amounts are integer minor units) and for display, so a value is never
 * shown with more precision than it is stored with.
 */
export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CHF'
  | 'JPY'
  | 'CAD'
  | 'AUD'
  | 'ALL'
  | 'TRY'
  | 'SEK'
  | 'NOK'
  | 'PLN'
  | 'CNY'
  | 'INR'
  | 'AED'
  | 'MXN';

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number;
  /** Badge tint used for the round currency badge (no flags/emoji). */
  tint: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, tint: '#2F9E6B' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, tint: '#3B6FD8' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2, tint: '#7B4FD0' },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2, tint: '#D04848' },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, tint: '#C2415D' },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', decimals: 2, tint: '#D9534F' },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2, tint: '#1F8A9E' },
  ALL: { code: 'ALL', name: 'Albanian Lek', symbol: 'L', decimals: 2, tint: '#B83232' },
  TRY: { code: 'TRY', name: 'Turkish Lira', symbol: '₺', decimals: 2, tint: '#C8432F' },
  SEK: { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', decimals: 2, tint: '#2B6CB0' },
  NOK: { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', decimals: 2, tint: '#A63A3A' },
  PLN: { code: 'PLN', name: 'Polish Złoty', symbol: 'zł', decimals: 2, tint: '#B5394B' },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2, tint: '#C9452F' },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, tint: '#D98A2B' },
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'AED', decimals: 2, tint: '#3C8D5A' },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', decimals: 2, tint: '#2E8B57' },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/** The currencies explicitly required by the product brief, shown first in pickers. */
export const PRIMARY_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'ALL', 'TRY'];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyDecimals(code: CurrencyCode): number {
  return CURRENCIES[code].decimals;
}
