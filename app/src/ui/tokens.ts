import type { AccentName, Category } from '../domain/types';

/**
 * TypeScript-side references to the design tokens in theme.css. UI code
 * never hard-codes colors: it uses these CSS variable references, or — for
 * user-chosen colors such as account tints — derives ink/soft variants here.
 */

export const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-9)', 'var(--chart-7)', 'var(--chart-10)', 'var(--chart-6)', 'var(--chart-8)'];

export const CATEGORY_COLOR: Record<Category, string> = {
  food: 'var(--chart-4)',
  transport: 'var(--chart-3)',
  shopping: 'var(--chart-2)',
  bills: 'var(--chart-8)',
  entertainment: 'var(--chart-7)',
  travel: 'var(--chart-9)',
  health: 'var(--chart-5)',
  subscriptions: 'var(--chart-10)',
  transfers: 'var(--chart-6)',
  income: 'var(--chart-1)',
  investing: 'var(--chart-2)',
  other: 'var(--chart-8)',
};

export const ACCENT_NAMES: AccentName[] = ['mint', 'violet', 'azure', 'amber', 'rose', 'emerald'];
export const ACCENT_LABEL: Record<AccentName, string> = { mint: 'Mint', violet: 'Violet', azure: 'Azure', amber: 'Amber', rose: 'Rose', emerald: 'Emerald' };

function rgb(hex: string): [number, number, number] {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '808080';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text color on top of a user-chosen background color. */
export function inkFor(hex: string): string {
  return luminance(hex) > 0.36 ? 'var(--ink-on-light)' : 'var(--ink-on-dark)';
}

/** Translucent tint of a user color for icon backgrounds (8-digit hex). */
export function soft(hex: string, alpha = 0x26): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha.toString(16).padStart(2, '0')}` : 'var(--surface-2)';
}

export function mixHex(a: string, b: string, t = 0.5): string {
  const x = rgb(a);
  const y = rgb(b);
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
