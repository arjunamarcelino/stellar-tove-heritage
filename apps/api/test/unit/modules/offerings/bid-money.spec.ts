import { describe, it, expect } from 'vitest';
import { computeEscrowStroops } from '@modules/offerings/constants/bid-money';
import { MAX_STROOPS } from '@common/constants/stroops.constant';

/**
 * Unit guard for the bid escrow-amount helper (TOV-156). `price × count` must be exact BigInt math
 * (stroops exceed 2^53), capped at the on-chain USDC ceiling (2^96−1), rejecting non-positive inputs.
 */
describe('computeEscrowStroops', () => {
  // ── positive ──────────────────────────────────────────────────────────────────────────────────
  it('multiplies price × count as canonical strings', () => {
    expect(computeEscrowStroops('100000000', '10')).toBe('1000000000');
    expect(computeEscrowStroops('1', '1')).toBe('1');
  });

  it('is exact well beyond Number.MAX_SAFE_INTEGER (no float coercion)', () => {
    // 9007199254740993 (2^53 + 1) × 1000 — a Number() path would lose the low digits.
    expect(computeEscrowStroops('9007199254740993', '1000')).toBe('9007199254740993000');
  });

  it('accepts a product exactly at the MAX_STROOPS ceiling', () => {
    expect(computeEscrowStroops(MAX_STROOPS.toString(), '1')).toBe(MAX_STROOPS.toString());
  });

  // ── negative / edge ───────────────────────────────────────────────────────────────────────────
  it('rejects a product above MAX_STROOPS', () => {
    expect(() => computeEscrowStroops(MAX_STROOPS.toString(), '2')).toThrow(/MAX_STROOPS/);
  });

  it('rejects a zero price or zero count', () => {
    expect(() => computeEscrowStroops('0', '10')).toThrow(/positive/);
    expect(() => computeEscrowStroops('100', '0')).toThrow(/positive/);
  });

  it('throws on a non-numeric input (BigInt SyntaxError)', () => {
    expect(() => computeEscrowStroops('abc', '1')).toThrow();
  });
});
