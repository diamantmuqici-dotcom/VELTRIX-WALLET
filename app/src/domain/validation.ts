/** Input validation shared by forms and domain operations. */

export const NOTE_MAX = 140;
export const NAME_MAX = 40;
export const TITLE_MAX = 48;

let segmenter: { segment: (s: string) => Iterable<unknown> } | null | undefined;

/** Counts user-perceived characters so emoji count as one. */
export function graphemeLength(s: string): number {
  if (!s) return 0;
  if (segmenter === undefined) {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<unknown> } }).Segmenter;
    segmenter = Seg ? new Seg(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(s)) n++;
    return n;
  }
  return Array.from(s).length;
}

/** Truncates by graphemes (never splits an emoji). */
export function truncateGraphemes(s: string, max: number): string {
  if (graphemeLength(s) <= max) return s;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) {
    let out = '';
    let n = 0;
    for (const part of new Seg(undefined, { granularity: 'grapheme' }).segment(s)) {
      if (n >= max) break;
      out += part.segment;
      n++;
    }
    return out;
  }
  return Array.from(s).slice(0, max).join('');
}

/** Removes control characters (keeps emoji and all printable Unicode) and trims. */
export function cleanText(s: string): string {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateName(s: string, label = 'Name'): string | null {
  const v = cleanText(s);
  if (!v) return `${label} is required`;
  if (graphemeLength(v) > NAME_MAX) return `${label} must be ${NAME_MAX} characters or fewer`;
  return null;
}

export function validateNote(s: string): string | null {
  if (graphemeLength(cleanText(s)) > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters`;
  return null;
}

export function normalizeUsername(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function validateUsername(s: string): string | null {
  const v = normalizeUsername(s);
  if (!v) return 'Username is required';
  if (v.length < 3) return 'Use at least 3 characters';
  if (v.length > 20) return 'Use 20 characters or fewer';
  if (!/^[a-z0-9][a-z0-9._]*$/.test(v)) return 'Letters, numbers, dots and underscores only';
  return null;
}

/** Optional display identifier: e-mail style or phone style. Purely cosmetic, never contacted. */
export function validateIdentifier(s: string): string | null {
  const v = String(s ?? '').trim();
  if (!v) return null;
  if (v.length > 60) return 'Too long';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const phone = /^\+?[0-9][0-9 ()-]{5,19}$/.test(v);
  if (!email && !phone) return 'Use an e-mail-style or phone-style identifier';
  return null;
}

export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function validateDisplayDigits(s: string): string | null {
  return /^\d{4}$/.test(s) ? null : 'Enter exactly 4 digits';
}

export function validateExpiry(s: string): string | null {
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(s) ? null : 'Use MM/YY';
}

export function initialsOf(name: string): string {
  const parts = cleanText(name).split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}
