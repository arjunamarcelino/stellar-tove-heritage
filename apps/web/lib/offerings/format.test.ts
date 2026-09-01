import { describe, it, expect } from 'vitest';
import {
  escrowAmount,
  usdcToStroops,
  stroopsToUsdc,
  formatUsdc,
  clampToBand,
  isWithinBand,
  countdownParts,
} from '@/lib/offerings/format';

describe('escrowAmount', () => {
  it('multiplies price × count', () => {
    expect(escrowAmount('5000000', 3)).toBe('15000000');
    expect(escrowAmount('0', 10)).toBe('0');
  });

  it('stays exact past 2^53 (BigInt path)', () => {
    // 10_000_000_000 stroops (1000 USDC) × 1_000_000 fractions overflows a JS number.
    expect(escrowAmount('10000000000', 1_000_000)).toBe('10000000000000000');
  });
});

describe('usdcToStroops / stroopsToUsdc round-trip', () => {
  it('accepts whole and fractional USDC', () => {
    expect(usdcToStroops('10')).toEqual({ ok: true, stroops: '100000000' });
    expect(usdcToStroops('10.0000000')).toEqual({ ok: true, stroops: '100000000' });
  });

  it('accepts sub-USDC ("0.5" → "5000000")', () => {
    expect(usdcToStroops('0.5')).toEqual({ ok: true, stroops: '5000000' });
  });

  it('rejects malformed input as invalid', () => {
    expect(usdcToStroops('')).toEqual({ ok: false, reason: 'invalid' });
    expect(usdcToStroops('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(usdcToStroops('1.')).toEqual({ ok: false, reason: 'invalid' });
    expect(usdcToStroops('-1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects > 7 decimals as too-precise (never rounds)', () => {
    expect(usdcToStroops('1.12345678')).toEqual({ ok: false, reason: 'too-precise' });
  });

  it('inverts stroops back to canonical 7-dp USDC', () => {
    expect(stroopsToUsdc('5000000')).toBe('0.5000000');
    expect(stroopsToUsdc('100000000')).toBe('10.0000000');
    expect(stroopsToUsdc('0')).toBe('0.0000000');
  });

  it('round-trips a value beyond 2^53', () => {
    const usdc = '1234567890.1234567';
    const forward = usdcToStroops(usdc);
    expect(forward).toEqual({ ok: true, stroops: '12345678901234567' });
    if (forward.ok) expect(stroopsToUsdc(forward.stroops)).toBe(usdc);
  });

  it('throws on a malformed stroops string (fail-closed)', () => {
    expect(() => stroopsToUsdc('1.5')).toThrow(RangeError);
    expect(() => stroopsToUsdc('-5')).toThrow(RangeError);
  });
});

describe('formatUsdc', () => {
  it('renders human USDC with grouped digits', () => {
    expect(formatUsdc('1000000000')).toBe('100.00');
    expect(formatUsdc('5000000')).toBe('0.50');
  });

  it('stays precise for large values (exact-string path, not Number())', () => {
    expect(formatUsdc('12345678901234567')).toBe('1,234,567,890.1234567');
  });
});

describe('clampToBand / isWithinBand', () => {
  it('returns low when below the band', () => {
    expect(clampToBand('40000000', '50000000', '90000000')).toBe('50000000');
  });

  it('returns the input when within the band', () => {
    expect(clampToBand('70000000', '50000000', '90000000')).toBe('70000000');
  });

  it('returns high when above the band', () => {
    expect(clampToBand('99000000', '50000000', '90000000')).toBe('90000000');
  });

  it('handles a degenerate low == high band', () => {
    expect(clampToBand('40000000', '60000000', '60000000')).toBe('60000000');
    expect(clampToBand('99000000', '60000000', '60000000')).toBe('60000000');
    expect(clampToBand('60000000', '60000000', '60000000')).toBe('60000000');
  });

  it('treats both edges as within the band (inclusive)', () => {
    expect(isWithinBand('50000000', '50000000', '90000000')).toBe(true);
    expect(isWithinBand('90000000', '50000000', '90000000')).toBe(true);
    expect(isWithinBand('49999999', '50000000', '90000000')).toBe(false);
    expect(isWithinBand('90000001', '50000000', '90000000')).toBe(false);
  });
});

describe('countdownParts', () => {
  const target = '2026-08-20T12:00:00.000Z';
  const targetMs = Date.parse(target);

  it('breaks the remaining span into d/h/m/s', () => {
    // 1 day, 2 hours, 3 minutes, 4 seconds before the target.
    const nowMs = targetMs - (((1 * 24 + 2) * 60 + 3) * 60 + 4) * 1000;
    expect(countdownParts(target, nowMs)).toEqual({
      totalMs: 93_784_000,
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      expired: false,
    });
  });

  it('is not expired one second before the target', () => {
    const parts = countdownParts(target, targetMs - 1000);
    expect(parts.expired).toBe(false);
    expect(parts.seconds).toBe(1);
  });

  it('is expired at the boundary (nowMs == target)', () => {
    expect(countdownParts(target, targetMs)).toEqual({
      totalMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      expired: true,
    });
  });

  it('clamps to zero (expired) after the target', () => {
    expect(countdownParts(target, targetMs + 60_000).expired).toBe(true);
  });
});
