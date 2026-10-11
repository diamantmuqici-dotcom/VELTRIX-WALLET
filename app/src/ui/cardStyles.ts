import type { Card, CardPattern, CardStyle } from '../domain/types';
import { luminance, mixHex } from './tokens';

/**
 * Demo card materials — centralized. These are physical "material" colors of
 * the fictional cards (like a product finish), not UI chrome colors.
 * None of them reproduces a real issuer's card design.
 */

export interface Material {
  name: string;
  from: string;
  via: string;
  to: string;
  ink: string;
  ink2: string;
  chip: 'gold' | 'silver';
  defaultPattern: CardPattern;
}

export const MATERIALS: Record<Exclude<CardStyle, 'custom'>, Material> = {
  obsidian: { name: 'Obsidian', from: '#1b1d22', via: '#26292f', to: '#0a0b0d', ink: '#f4f4f5', ink2: 'rgba(244,244,245,0.62)', chip: 'gold', defaultPattern: 'lines' },
  glacier: { name: 'Glacier', from: '#e4eef8', via: '#bfd5ea', to: '#8eaed3', ink: '#0d2134', ink2: 'rgba(13,33,52,0.62)', chip: 'silver', defaultPattern: 'waves' },
  emerald: { name: 'Emerald', from: '#0f6a51', via: '#0b5a44', to: '#043428', ink: '#ecfdf5', ink2: 'rgba(236,253,245,0.66)', chip: 'gold', defaultPattern: 'topo' },
  royal: { name: 'Royal', from: '#33227a', via: '#251863', to: '#120a35', ink: '#f6f3ff', ink2: 'rgba(246,243,255,0.66)', chip: 'gold', defaultPattern: 'mesh' },
  aurora: { name: 'Aurora', from: '#1d3a6e', via: '#3a2e7c', to: '#0d5e66', ink: '#f0f9ff', ink2: 'rgba(240,249,255,0.68)', chip: 'silver', defaultPattern: 'waves' },
  carbon: { name: 'Carbon', from: '#2c2f35', via: '#1d1f23', to: '#111215', ink: '#e7e9ee', ink2: 'rgba(231,233,238,0.6)', chip: 'silver', defaultPattern: 'grid' },
  pearl: { name: 'Pearl', from: '#faf7f2', via: '#ebe5dc', to: '#d6cdbf', ink: '#2a251f', ink2: 'rgba(42,37,31,0.6)', chip: 'gold', defaultPattern: 'dots' },
  neon: { name: 'Neon', from: '#0c0b16', via: '#1b1031', to: '#06191e', ink: '#f6f5ff', ink2: 'rgba(246,245,255,0.66)', chip: 'silver', defaultPattern: 'lines' },
  midnight: { name: 'Midnight Blue', from: '#13275a', via: '#0f1f47', to: '#070f24', ink: '#eef2ff', ink2: 'rgba(238,242,255,0.66)', chip: 'gold', defaultPattern: 'topo' },
};

export const STYLE_ORDER: CardStyle[] = ['obsidian', 'glacier', 'emerald', 'royal', 'aurora', 'carbon', 'pearl', 'neon', 'midnight', 'custom'];

export const STYLE_NAME: Record<CardStyle, string> = {
  obsidian: 'Obsidian',
  glacier: 'Glacier',
  emerald: 'Emerald',
  royal: 'Royal',
  aurora: 'Aurora',
  carbon: 'Carbon',
  pearl: 'Pearl',
  neon: 'Neon',
  midnight: 'Midnight Blue',
  custom: 'Custom',
};

export const PATTERN_NAME: Record<CardPattern, string> = {
  none: 'None',
  lines: 'Lines',
  waves: 'Waves',
  grid: 'Grid',
  topo: 'Contour',
  dots: 'Dots',
  mesh: 'Mesh',
};

/** Preset accent colors offered in the card editor (fictional finishes). */
export const CARD_ACCENTS = ['#2dd4a7', '#e5c07b', '#c0c7d2', '#7c6cf2', '#f45b69', '#3b82f6', '#22d3ee', '#f5a524', '#e879f9', '#a3e635'];
export const CUSTOM_PRESETS: Array<[string, string]> = [
  ['#1e293b', '#0f766e'],
  ['#3b0764', '#be185d'],
  ['#0c4a6e', '#22d3ee'],
  ['#422006', '#ca8a04'],
  ['#14532d', '#84cc16'],
  ['#111827', '#6b7280'],
];

export interface ResolvedMaterial {
  from: string;
  via: string;
  to: string;
  ink: string;
  ink2: string;
  chip: 'gold' | 'silver';
  light: boolean;
}

export function cardGradient(card: Pick<Card, 'style' | 'customFrom' | 'customTo'>): ResolvedMaterial {
  if (card.style !== 'custom') {
    const m = MATERIALS[card.style] ?? MATERIALS.obsidian;
    return { from: m.from, via: m.via, to: m.to, ink: m.ink, ink2: m.ink2, chip: m.chip, light: luminance(m.via) > 0.36 };
  }
  const via = mixHex(card.customFrom, card.customTo, 0.5);
  const light = luminance(via) > 0.36;
  return {
    from: card.customFrom,
    via,
    to: card.customTo,
    ink: light ? '#14161a' : '#f6f7f9',
    ink2: light ? 'rgba(20,22,26,0.62)' : 'rgba(246,247,249,0.66)',
    chip: 'gold',
    light,
  };
}
