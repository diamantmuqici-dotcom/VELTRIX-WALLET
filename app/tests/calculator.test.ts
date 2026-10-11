import { describe, expect, it } from 'vitest';
import { CALC_INITIAL, calcPress, type CalcKey } from '../src/domain/calculator';

const run = (keys: CalcKey[]) => keys.reduce(calcPress, CALC_INITIAL);
const chars = (s: string): CalcKey[] => s.split(' ').filter(Boolean) as CalcKey[];

describe('decimal-safe calculator', () => {
  it('adds decimals exactly (0.1 + 0.2 = 0.3)', () => {
    expect(run(chars('. 1 + . 2 =')).entry).toBe('0.3');
    expect(run(chars('1 . 1 × 3 =')).entry).toBe('3.3');
  });
  it('chains operations left to right', () => {
    expect(run(chars('2 + 3 × 4 =')).entry).toBe('20');
    expect(run(chars('1 0 0 − 2 5 ÷ 3 =')).entry).toBe('25');
  });
  it('handles percent, sign and backspace', () => {
    expect(run(chars('2 5 0 %')).entry).toBe('2.5');
    expect(run(chars('7 ±')).entry).toBe('-7');
    expect(run(chars('1 2 3 back')).entry).toBe('12');
  });
  it('rounds long divisions to 10 decimals and reports errors', () => {
    expect(run(chars('1 ÷ 3 =')).entry).toBe('0.3333333333');
    const e = run(chars('5 ÷ 0 ='));
    expect(e.error).toBe('Can’t divide by zero');
    expect(calcPress(e, '4').entry).toBe('4');
  });
  it('caps input length and rejects overflow', () => {
    expect(run(Array(20).fill('9') as CalcKey[]).entry).toHaveLength(15);
    const big = run([...(Array(15).fill('9') as CalcKey[]), '×', ...(Array(15).fill('9') as CalcKey[]), '=']);
    expect(big.error).toBe('Number too large');
  });
  it('ignores a second decimal point and clears', () => {
    expect(run(chars('1 . . 5')).entry).toBe('1.5');
    expect(run(chars('9 + 1 C'))).toEqual(CALC_INITIAL);
  });
});
