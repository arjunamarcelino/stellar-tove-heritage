import { describe, it, expect } from 'vitest';
import { checkRfqBounds } from '@/lib/rfq/validation';
import type { RfqInput } from '@/lib/types/api';

const valid: RfqInput = {
  fractionCount: 100,
  maxPricePerFractionStroops: '150000000',
  expiryHours: 48,
};
const code = (r: ReturnType<typeof checkRfqBounds>) => (r && r.status === 'error' ? r.code : null);

describe('checkRfqBounds', () => {
  it('returns null for valid input', () => {
    expect(checkRfqBounds(valid)).toBeNull();
  });

  it('rejects a zero / non-numeric price as RFQ_INVALID_PRICE', () => {
    expect(code(checkRfqBounds({ ...valid, maxPricePerFractionStroops: '0' }))).toBe(
      'RFQ_INVALID_PRICE',
    );
    expect(code(checkRfqBounds({ ...valid, maxPricePerFractionStroops: 'x' }))).toBe(
      'RFQ_INVALID_PRICE',
    );
  });

  it('accepts price = 2^96-1 but rejects 2^96', () => {
    expect(
      checkRfqBounds({
        fractionCount: 1,
        maxPricePerFractionStroops: '79228162514264337593543950335',
        expiryHours: 48,
      }),
    ).toBeNull();
    expect(
      code(
        checkRfqBounds({
          fractionCount: 1,
          maxPricePerFractionStroops: '79228162514264337593543950336',
          expiryHours: 48,
        }),
      ),
    ).toBe('RFQ_INVALID_PRICE');
  });

  it('rejects a < 1 / non-integer count as VALIDATION_FAILED', () => {
    expect(code(checkRfqBounds({ ...valid, fractionCount: 0 }))).toBe('VALIDATION_FAILED');
    expect(code(checkRfqBounds({ ...valid, fractionCount: 1.5 }))).toBe('VALIDATION_FAILED');
  });

  it('rejects a non-preset expiry as VALIDATION_FAILED', () => {
    expect(code(checkRfqBounds({ ...valid, expiryHours: 5 as 24 }))).toBe('VALIDATION_FAILED');
  });

  it('rejects price × count > i128 as RFQ_AMOUNT_OVERFLOW (independent of the price bound)', () => {
    expect(
      code(
        checkRfqBounds({
          fractionCount: 9_000_000_000_000_000,
          maxPricePerFractionStroops: '79228162514264337593543950335',
          expiryHours: 48,
        }),
      ),
    ).toBe('RFQ_AMOUNT_OVERFLOW');
  });
});
