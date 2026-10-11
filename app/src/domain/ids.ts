/** Local identifiers. They are never payment references — the UI shows them as "SIM-…" ids. */

function randomBase36(len: number): string {
  const bytes = new Uint8Array(len);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

let seq = 0;

export function makeId(prefix: string): string {
  seq = (seq + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(2, '0')}${randomBase36(5)}`;
}

/** Deterministic id generator for tests and sample data. */
export function sequentialIds(seed = 'x'): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `${prefix}_${seed}${(++n).toString(36).padStart(5, '0')}`;
}

/** Human-friendly simulator reference shown in the UI, e.g. "SIM-4K2Q-9ZPX". */
export function simRef(id: string): string {
  const core = id.replace(/^[a-z]+_/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tail = core.slice(-8).padStart(8, '0');
  return `SIM-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** Fictional wallet id, e.g. "VX-DEMO-7F3K-29QA". */
export function makeWalletId(): string {
  const r = randomBase36(8).toUpperCase();
  return `VX-DEMO-${r.slice(0, 4)}-${r.slice(4)}`;
}

export function randomDigits(n: number): string {
  const bytes = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined') globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < n; i++) s += String(bytes[i] % 10);
  return s;
}
