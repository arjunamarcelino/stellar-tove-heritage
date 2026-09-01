import { describe, it, expect } from 'vitest';

import { formatStroops } from './amount';

describe('formatStroops', () => {
  it('formats at full precision (÷10^7), trimming trailing zeros (positive)', () => {
    expect(formatStroops('1000000')).toBe('0.1'); // 0.1000000 → 0.1
    expect(formatStroops('1234567')).toBe('0.1234567');
    expect(formatStroops('12345670')).toBe('1.234567');
  });

  it('handles zero and whole numbers (edge)', () => {
    expect(formatStroops('0')).toBe('0');
    expect(formatStroops('10000000')).toBe('1');
    expect(formatStroops('50000000')).toBe('5');
  });

  it('groups the integer part (edge)', () => {
    expect(formatStroops('800000', 0)).toBe('800,000'); // publicFloat: decimals 0
    expect(formatStroops('12000000000')).toBe('1,200');
  });

  it('preserves precision far above 2^53 (BigInt path) (edge)', () => {
    const raw = '170141183460469231731687303715884105727'; // ~ i128 max
    // decimals 0 → grouped integer, no float, no loss
    const out = formatStroops(raw, 0);
    expect(out.replace(/,/g, '')).toBe(raw);
  });

  it('rounds half-up to displayDecimals when requested (edge)', () => {
    expect(formatStroops('1250000', 7, 2)).toBe('0.13'); // 0.125 → 0.13 (half-up)
    expect(formatStroops('1240000', 7, 2)).toBe('0.12');
    expect(formatStroops('1250000', 7, 2, { rounding: 'trunc' })).toBe('0.12');
  });

  it('appends a symbol when provided (edge)', () => {
    expect(formatStroops('1000000', 7, undefined, { symbol: 'XLM' })).toBe('0.1 XLM');
  });

  it('emits no trailing ".0" when displayDecimals is 0 (edge)', () => {
    expect(formatStroops('12345670', 7, 0)).toBe('1'); // rounds down, no fractional part
    expect(formatStroops('19999999', 7, 0)).toBe('2'); // half-up carries into the integer
  });

  it('pads out when displayDecimals exceeds the asset scale (edge)', () => {
    expect(formatStroops('1000000', 7, 9)).toBe('0.100000000'); // 0.1 shown to 9 places
  });

  it('formats negative magnitudes (edge)', () => {
    expect(formatStroops('-1234567')).toBe('-0.1234567');
    expect(formatStroops('-0')).toBe('0');
  });

  it('throws on a non-integer input (negative)', () => {
    expect(() => formatStroops('12.5')).toThrow();
    expect(() => formatStroops('abc')).toThrow();
    expect(() => formatStroops('')).toThrow();
  });
});
