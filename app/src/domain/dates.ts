import type { DayKey } from './types';

/** All date logic uses the device's local time zone. */

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthKeyOf(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function isDayKey(s: unknown): s is DayKey {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDayKey(s);
  return !Number.isNaN(d.getTime()) && dayKey(d) === s;
}

/** Local midnight of a YYYY-MM-DD key. */
export function parseDayKey(k: DayKey): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}

/** Adds months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

/** Monday-based week start. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const dow = (s.getDay() + 6) % 7;
  return addDays(s, -dow);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, opts);
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts);
    }
    dtfCache.set(key, f);
  }
  return f;
}

/** "Today", "Yesterday", "Mon, Oct 6" or "Oct 6, 2025". */
export function formatDayLabel(iso: string | Date, locale = 'en-US', now = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = daysBetween(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  if (d.getFullYear() === now.getFullYear()) return dtf(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  return dtf(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export function formatShortDate(iso: string | Date, locale = 'en-US'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dtf(locale, { month: 'short', day: 'numeric' }).format(d);
}

export function formatFullDate(iso: string | Date, locale = 'en-US'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dtf(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

export function formatTime(iso: string | Date, locale = 'en-US'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dtf(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatDateTime(iso: string | Date, locale = 'en-US'): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dtf(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatMonthKey(key: string, locale = 'en-US', short = false): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return dtf(locale, short ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(d);
}

export function formatWeekday(d: Date, locale = 'en-US'): string {
  return dtf(locale, { weekday: 'short' }).format(d);
}

export function relativeTime(iso: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  const days = Math.round(diff / 86400);
  if (days < 30) return `${days} d ago`;
  return formatShortDate(iso);
}
