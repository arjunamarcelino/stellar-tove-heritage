import { describe, it, expect } from 'vitest';
import { checkQuoteBounds } from '@/lib/quote/validation';
import { quoteInput } from '@/test/fixtures/quote';
import type { QuoteInput } from '@/lib/types/api';

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({ ...quoteInput, ...over });

function code(result: ReturnType<typeof checkQuoteBounds>): string | null {
  return result === null ? null : result.status === 'error' ? result.code : 'UNEXPECTED';
}

describe('checkQuoteBounds', () => {
  it('returns null for fully valid input', () => {
    expect(checkQuoteBounds(base())).toBeNull();
  });

  it('shape-guards a null / primitive input as VALIDATION_FAILED (never throws)', () => {
    expect(code(checkQuoteBounds(null as never))).toBe('VALIDATION_FAILED');
    expect(code(checkQuoteBounds(5 as never))).toBe('VALIDATION_FAILED');
    expect(code(checkQuoteBounds('nope' as never))).toBe('VALIDATION_FAILED');
  });

  // ── price (u96) ──
  it('rejects a zero / leading-zero / oversized price as QUOTE_INVALID_PRICE', () => {
    expect(code(checkQuoteBounds(base({ pricePerFractionStroops: '0' })))).toBe(
      'QUOTE_INVALID_PRICE',
    );
    expect(code(checkQuoteBounds(base({ pricePerFractionStroops: '01' })))).toBe(
      'QUOTE_INVALID_PRICE',
    );
    expect(
      code(checkQuoteBounds(base({ pricePerFractionStroops: '79228162514264337593543950336' }))), // 2^96
    ).toBe('QUOTE_INVALID_PRICE');
  });

  it('accepts price = 2^96-1 (the u96 max)', () => {
    expect(
      checkQuoteBounds(
        base({ pricePerFractionStroops: '79228162514264337593543950335', fractionCount: 1 }),
      ),
    ).toBeNull();
  });

  // ── count (integer >= 1) ──
  it('rejects a zero / non-integer / unsafe-integer count as VALIDATION_FAILED', () => {
    expect(code(checkQuoteBounds(base({ fractionCount: 0 })))).toBe('VALIDATION_FAILED');
    expect(code(checkQuoteBounds(base({ fractionCount: 1.5 })))).toBe('VALIDATION_FAILED');
    expect(code(checkQuoteBounds(base({ fractionCount: 2 ** 53 + 1 })))).toBe('VALIDATION_FAILED');
  });

  // ── product (i128), independent of the price bound ──
  it('rejects price × count > i128 as QUOTE_AMOUNT_OVERFLOW even when price alone is within u96', () => {
    expect(
      code(
        checkQuoteBounds(
          base({
            pricePerFractionStroops: '79228162514264337593543950335',
            fractionCount: 9_000_000_000_000_000,
          }),
        ),
      ),
    ).toBe('QUOTE_AMOUNT_OVERFLOW');
  });

  // ── validUntil: STRUCTURE only (C1) ──
  it('accepts a Z instant and a ±HH:MM offset instant', () => {
    expect(checkQuoteBounds(base({ validUntil: '2026-08-25T12:00:00.000Z' }))).toBeNull();
    expect(checkQuoteBounds(base({ validUntil: '2026-08-25T12:00:00+02:00' }))).toBeNull();
  });

  it('rejects a validUntil without an explicit tz offset (bare wall-clock) as QUOTE_INVALID_VALIDITY', () => {
    expect(code(checkQuoteBounds(base({ validUntil: '2026-08-25T12:00:00' })))).toBe(
      'QUOTE_INVALID_VALIDITY',
    );
  });

  it('rejects an unparseable validUntil as QUOTE_INVALID_VALIDITY', () => {
    expect(code(checkQuoteBounds(base({ validUntil: 'not-a-date' })))).toBe(
      'QUOTE_INVALID_VALIDITY',
    );
  });

  it('C1: accepts a PAST but well-formed instant (structure-only; the server owns the > now check)', () => {
    expect(checkQuoteBounds(base({ validUntil: '2020-01-01T00:00:00.000Z' }))).toBeNull();
  });
});
