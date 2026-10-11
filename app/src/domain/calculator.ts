import Big from 'big.js';

/**
 * A small decimal-safe calculator (big.js, no binary floating point):
 * 0.1 + 0.2 = 0.3. Immediate-execution semantics like a pocket calculator.
 */

export type CalcOp = '+' | '−' | '×' | '÷';
export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | CalcOp | '=' | 'C' | 'back' | '%' | '±';

export interface CalcState {
  /** text currently being typed (or the last result) */
  entry: string;
  /** stored left operand */
  acc: string | null;
  op: CalcOp | null;
  /** true right after "=" or an operator: the next digit starts a new entry */
  fresh: boolean;
  error: string | null;
  /** human-readable expression shown above the result */
  expr: string;
}

export const CALC_INITIAL: CalcState = { entry: '0', acc: null, op: null, fresh: true, error: null, expr: '' };

const MAX_DIGITS = 15;

function apply(a: string, op: CalcOp, b: string): { value: string } | { error: string } {
  const x = new Big(a);
  const y = new Big(b);
  let r: Big;
  switch (op) {
    case '+':
      r = x.plus(y);
      break;
    case '−':
      r = x.minus(y);
      break;
    case '×':
      r = x.times(y);
      break;
    case '÷':
      if (y.eq(0)) return { error: 'Can’t divide by zero' };
      r = x.div(y);
      break;
  }
  if (r.abs().gte(new Big('1e15'))) return { error: 'Number too large' };
  return { value: normalize(r) };
}

function normalize(b: Big): string {
  const s = b.round(10, Big.roundHalfUp).toFixed(10).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function calcPress(s: CalcState, key: CalcKey): CalcState {
  if (key === 'C') return CALC_INITIAL;
  if (s.error) {
    if (/^\d$/.test(key) || key === '.') s = CALC_INITIAL;
    else return s;
  }
  if (/^\d$/.test(key)) {
    if (s.fresh) return { ...s, entry: key, fresh: false, expr: s.op ? s.expr : '' };
    const digits = s.entry.replace(/[-.]/g, '').length;
    if (digits >= MAX_DIGITS) return s;
    return { ...s, entry: s.entry === '0' ? key : s.entry === '-0' ? `-${key}` : s.entry + key };
  }
  if (key === '.') {
    if (s.fresh) return { ...s, entry: '0.', fresh: false, expr: s.op ? s.expr : '' };
    if (s.entry.includes('.')) return s;
    return { ...s, entry: `${s.entry}.` };
  }
  if (key === 'back') {
    if (s.fresh) return s;
    const e = s.entry.slice(0, -1);
    return { ...s, entry: e === '' || e === '-' ? '0' : e };
  }
  if (key === '±') {
    if (s.entry === '0') return s;
    return { ...s, entry: s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}` };
  }
  if (key === '%') {
    const v = normalize(new Big(s.entry).div(100));
    return { ...s, entry: v, fresh: true };
  }
  const entry = s.entry.endsWith('.') ? s.entry.slice(0, -1) : s.entry;
  if (key === '=') {
    if (!s.op || s.acc === null) return { ...s, entry, fresh: true };
    const r = apply(s.acc, s.op, entry);
    if ('error' in r) return { ...CALC_INITIAL, error: r.error, expr: `${s.acc} ${s.op} ${entry} =` };
    return { entry: r.value, acc: null, op: null, fresh: true, error: null, expr: `${s.acc} ${s.op} ${entry} =` };
  }
  // operator
  const op = key as CalcOp;
  if (s.op && s.acc !== null && !s.fresh) {
    const r = apply(s.acc, s.op, entry);
    if ('error' in r) return { ...CALC_INITIAL, error: r.error };
    return { entry: r.value, acc: r.value, op, fresh: true, error: null, expr: `${r.value} ${op}` };
  }
  return { ...s, entry, acc: entry, op, fresh: true, expr: `${entry} ${op}` };
}
