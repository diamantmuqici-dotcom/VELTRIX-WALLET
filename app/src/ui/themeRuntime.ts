import { useEffect, useState } from 'react';
import type { AccentName, AnimationLevel, ThemeMode } from '../domain/types';
import { setSystemBars } from '../platform/bridge';

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function systemReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Resolves "system" against the OS setting (browser media query or native callback). */
export function useResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  const [sys, setSys] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => setSys(mq.matches);
    mq?.addEventListener?.('change', onChange);
    window.__veltrixSystemTheme = (dark: boolean) => setSys(dark);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);
  return mode === 'system' ? (sys ? 'dark' : 'light') : mode;
}

/** Applies theme tokens to <html> and themes the Android system bars to match. */
export function applyTheme(theme: 'light' | 'dark', accent: AccentName, motion: AnimationLevel, mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  root.dataset.motion = motion === 'full' && systemReducedMotion() ? 'reduced' : motion;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (theme === 'dark' ? '#07090d' : '#f3f4f7');
  setSystemBars(mode, theme === 'dark', bg);
}
