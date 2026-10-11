import { OP_ERROR_TEXT, type AppState, type OpContext, type OpResult } from '../domain/types';
import { haptic } from '../platform/bridge';
import { getSnapshot, run } from './store';
import { toast } from './ui';

export function errorText(r: { error: keyof typeof OP_ERROR_TEXT; detail?: string }): string {
  return r.detail ?? OP_ERROR_TEXT[r.error];
}

function vibrate(kind: 'success' | 'error' | 'tap'): void {
  if (getSnapshot().app?.settings.haptics !== false) haptic(kind);
}

/**
 * Runs a domain operation against the store. Shows the error as a toast
 * (unless `quiet`) and an optional success toast. Returns the op result.
 */
export function act<T extends object>(
  op: (s: AppState, ctx: OpContext) => OpResult<T>,
  opts: { success?: string; quiet?: boolean; haptics?: boolean } = {},
): OpResult<T> {
  const r = run(op);
  if (r.ok) {
    if (opts.success && !r.duplicate) toast(opts.success, 'success');
    if (opts.haptics !== false && opts.success) vibrate('success');
  } else {
    if (!opts.quiet) toast(errorText(r), 'error');
    vibrate('error');
  }
  return r;
}

/** Stable per-mount operation key so a double-tapped confirm button cannot post twice. */
export function newOpKey(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}
