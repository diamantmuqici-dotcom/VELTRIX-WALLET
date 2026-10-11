import { CURRENCIES, type CurrencyCode } from '../../domain/currency';
import { formatDateTime, formatDayLabel, formatShortDate, formatTime } from '../../domain/dates';
import { formatMoney, formatMoneyParts, formatNumber, formatPercent, HIDDEN_AMOUNT, type SignMode } from '../../domain/money';
import { useApp } from '../../state/store';

/** Formatting helpers bound to the user's number-format and privacy settings. */
export function useFmt() {
  const app = useApp();
  const locale = app.settings.numberLocale;
  const hidden = app.settings.hideBalances;
  return {
    locale,
    hidden,
    money: (minor: number, currency: CurrencyCode, opts: { sign?: SignMode; sensitive?: boolean; compact?: boolean; code?: boolean } = {}) =>
      formatMoney(minor, currency, { locale, sign: opts.sign, compact: opts.compact, code: opts.code, hidden: !!opts.sensitive && hidden }),
    num: (v: number, min = 0, max = 2) => formatNumber(v, locale, min, max),
    pct: (v: number | null, digits = 1, signed = true) => formatPercent(v, locale, digits, signed),
    day: (iso: string) => formatDayLabel(iso, locale),
    short: (iso: string | Date) => formatShortDate(iso, locale),
    time: (iso: string) => formatTime(iso, locale),
    dateTime: (iso: string) => formatDateTime(iso, locale),
    major: (minor: number, currency: CurrencyCode) => minor / 10 ** CURRENCIES[currency].decimals,
  };
}

/** Amount with optional sign coloring. `sensitive` amounts respect "hide balances". */
export function Money({
  minor,
  currency,
  sign,
  sensitive,
  tone,
  className,
  compact,
}: {
  minor: number;
  currency: CurrencyCode;
  sign?: SignMode;
  sensitive?: boolean;
  tone?: 'auto' | 'pos-only';
  className?: string;
  compact?: boolean;
}) {
  const f = useFmt();
  const text = f.money(minor, currency, { sign, sensitive, compact });
  const toneCls = tone === 'auto' ? (minor > 0 ? ' pos' : minor < 0 ? ' neg' : '') : tone === 'pos-only' && minor > 0 ? ' pos' : '';
  return <span className={`amount${toneCls}${className ? ` ${className}` : ''}`}>{text}</span>;
}

/** Large balance with de-emphasized fraction digits. */
export function HeroAmount({ minor, currency, hidden }: { minor: number; currency: CurrencyCode; hidden: boolean }) {
  const f = useFmt();
  if (hidden) {
    const sym = CURRENCIES[currency].symbol;
    return (
      <span className="amount">
        {sym}
        {sym.length > 1 ? '\u00A0' : ''}
        {HIDDEN_AMOUNT}
      </span>
    );
  }
  const p = formatMoneyParts(minor, currency, { locale: f.locale });
  if (!p.fraction) return <span className="amount">{p.text}</span>;
  const cut = p.text.lastIndexOf(p.decimalSeparator + p.fraction);
  if (cut < 0) return <span className="amount">{p.text}</span>;
  return (
    <span className="amount">
      {p.text.slice(0, cut)}
      <span className="frac">{p.text.slice(cut)}</span>
    </span>
  );
}
