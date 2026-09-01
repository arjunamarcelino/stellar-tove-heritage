import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRfqDto } from '../../../../src/modules/marketplace/rfqs/dto/create-rfq.dto';

const VALID = {
  artworkId: '00000000-0000-4000-8000-0000000a0001',
  fractionCount: 100,
  maxPricePerFractionStroops: '150000000',
  expiryHours: 72,
};

const errorsFor = (patch: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateRfqDto, { ...VALID, ...patch }));

/** 2^96 - 1 — the max stroops numeric(39,0) tolerates (28 digits, within @MaxLength(39)). */
const MAX_STROOPS = '79228162514264337593543950335';

describe('CreateRfqDto', () => {
  // --- accept -------------------------------------------------------------
  it('accepts the canonical body', () => {
    expect(errorsFor({})).toHaveLength(0);
  });

  it('accepts an omitted expiryHours (optional, defaults in the service)', () => {
    const dto = plainToInstance(CreateRfqDto, {
      artworkId: VALID.artworkId,
      fractionCount: VALID.fractionCount,
      maxPricePerFractionStroops: VALID.maxPricePerFractionStroops,
    });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it.each([1, 48, 168])('accepts expiryHours boundary %d', (expiryHours) => {
    expect(errorsFor({ expiryHours })).toHaveLength(0);
  });

  it('accepts a 2^96-1 (max-precision) stroops string', () => {
    expect(errorsFor({ maxPricePerFractionStroops: MAX_STROOPS })).toHaveLength(0);
  });

  // --- reject: artworkId -------------------------------------------------
  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['empty', ''],
  ])('rejects artworkId: %s', (_label, artworkId) => {
    expect(errorsFor({ artworkId }).length).toBeGreaterThan(0);
  });

  it('rejects a missing artworkId', () => {
    const dto = plainToInstance(CreateRfqDto, {
      fractionCount: VALID.fractionCount,
      maxPricePerFractionStroops: VALID.maxPricePerFractionStroops,
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  // --- reject: fractionCount ---------------------------------------------
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects fractionCount: %s', (_label, fractionCount) => {
    expect(errorsFor({ fractionCount }).length).toBeGreaterThan(0);
  });

  // --- reject: maxPricePerFractionStroops -----------------------------
  it.each([
    ['decimal', '1.5'],
    ['non-numeric', 'abc'],
    ['empty', ''],
    ['negative', '-5'],
    ['leading zero', '007'],
    ['40 digits (> MaxLength 39)', '1'.repeat(40)],
  ])('rejects maxPricePerFractionStroops: %s', (_label, maxPricePerFractionStroops) => {
    expect(errorsFor({ maxPricePerFractionStroops }).length).toBeGreaterThan(0);
  });

  it('rejects a numeric (non-string) price', () => {
    expect(errorsFor({ maxPricePerFractionStroops: 150000000 }).length).toBeGreaterThan(0);
  });

  // --- reject: expiryHours -----------------------------------------------
  it.each([
    ['zero (< 1)', 0],
    ['169 (> 168)', 169],
    ['non-integer', 2.5],
  ])('rejects expiryHours: %s', (_label, expiryHours) => {
    expect(errorsFor({ expiryHours }).length).toBeGreaterThan(0);
  });
});
