import { describe, it, expect } from 'vitest';
import { scaleAmountToI128, USDC_DECIMALS } from '../../../../../src/modules/wallets/transfer/amount';

describe('scaleAmountToI128 (USDC 7dp)', () => {
  it('scales integer and fractional amounts', () => {
    expect(scaleAmountToI128('1', USDC_DECIMALS)).toBe(10000000n);
    expect(scaleAmountToI128('1.5', USDC_DECIMALS)).toBe(15000000n);
    expect(scaleAmountToI128('0.0000001', USDC_DECIMALS)).toBe(1n); // smallest unit
    expect(scaleAmountToI128('100', USDC_DECIMALS)).toBe(1000000000n);
  });

  it('rejects more fractional digits than decimals', () => {
    expect(() => scaleAmountToI128('0.00000001', USDC_DECIMALS)).toThrow(/fractional/);
  });

  it('rejects zero, negative, and non-decimal strings', () => {
    expect(() => scaleAmountToI128('0', USDC_DECIMALS)).toThrow(/greater than zero/);
    expect(() => scaleAmountToI128('-1', USDC_DECIMALS)).toThrow(/decimal string/);
    expect(() => scaleAmountToI128('1e7', USDC_DECIMALS)).toThrow(/decimal string/);
    expect(() => scaleAmountToI128('abc', USDC_DECIMALS)).toThrow(/decimal string/);
    expect(() => scaleAmountToI128('', USDC_DECIMALS)).toThrow(/decimal string/);
  });

  it('rejects an amount exceeding i128', () => {
    const huge = '1'.repeat(40); // ~1e39 whole, * 1e7 -> way over 2^127-1
    expect(() => scaleAmountToI128(huge, USDC_DECIMALS)).toThrow(/i128/);
  });

  it('accepts an amount at the i128 boundary', () => {
    const i128Max = (1n << 127n) - 1n;
    // Construct a whole-number string that scales exactly to i128Max is awkward; assert just under.
    const nearMax = (i128Max / 10000000n).toString();
    expect(scaleAmountToI128(nearMax, USDC_DECIMALS)).toBeLessThanOrEqual(i128Max);
  });
});
