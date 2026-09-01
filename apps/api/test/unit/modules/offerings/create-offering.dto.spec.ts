import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateOfferingDto } from '../../../../src/modules/backoffice/offerings/dto/create-offering.dto';

const VALID = {
  artwork_id: '00000000-0000-4000-8000-0000000a0001',
  low_price_stroops: '50000000',
  high_price_stroops: '150000000',
  window_open_at: '2026-09-01T00:00:00Z',
  window_close_at: '2026-09-08T00:00:00Z',
};

const errorsFor = (patch: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateOfferingDto, { ...VALID, ...patch }));

/** 2^96 - 1 — the max stroops the numeric(39,0) band tolerates (28 digits, within @MaxLength(39)). */
const MAX_STROOPS = '79228162514264337593543950335';

describe('CreateOfferingDto', () => {
  // --- accept -------------------------------------------------------------
  it('accepts the canonical body (Z-suffixed timestamps)', () => {
    expect(errorsFor({})).toHaveLength(0);
  });

  it('accepts explicit ±hh:mm offset timestamps', () => {
    expect(
      errorsFor({ window_open_at: '2026-09-01T00:00:00+07:00', window_close_at: '2026-09-08T00:00:00-05:30' }),
    ).toHaveLength(0);
  });

  it('accepts a 2^96-1 (max-precision) stroops string', () => {
    expect(errorsFor({ low_price_stroops: '1', high_price_stroops: MAX_STROOPS })).toHaveLength(0);
  });

  // --- reject: uuid -------------------------------------------------------
  it.each([
    ['not a uuid', 'not-a-uuid'],
    ['empty', ''],
  ])('rejects artwork_id: %s', (_label, artwork_id) => {
    expect(errorsFor({ artwork_id }).length).toBeGreaterThan(0);
  });

  it('rejects a missing artwork_id', () => {
    const dto = plainToInstance(CreateOfferingDto, {
      low_price_stroops: VALID.low_price_stroops,
      high_price_stroops: VALID.high_price_stroops,
      window_open_at: VALID.window_open_at,
      window_close_at: VALID.window_close_at,
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  // --- reject: stroops ----------------------------------------------------
  it.each([
    ['decimal', '1.5'],
    ['non-numeric', 'abc'],
    ['empty', ''],
    ['negative', '-5'],
    ['leading zero', '007'],
    ['40 digits (> MaxLength 39)', '1'.repeat(40)],
  ])('rejects low_price_stroops: %s', (_label, low_price_stroops) => {
    expect(errorsFor({ low_price_stroops }).length).toBeGreaterThan(0);
  });

  it.each([
    ['decimal', '1.5'],
    ['non-numeric', 'abc'],
    ['negative', '-5'],
    ['leading zero', '007'],
  ])('rejects high_price_stroops: %s', (_label, high_price_stroops) => {
    expect(errorsFor({ high_price_stroops }).length).toBeGreaterThan(0);
  });

  // --- reject: timestamps -------------------------------------------------
  it.each([
    ['offset-less date-time', '2026-09-01T00:00:00'],
    ['date-only', '2026-09-01'],
  ])('rejects offset-less window_open_at: %s (TZ_OFFSET_RE guard)', (_label, window_open_at) => {
    expect(errorsFor({ window_open_at }).length).toBeGreaterThan(0);
  });

  it.each([
    ['calendar-invalid month 13', '2026-13-01T00:00:00Z'],
    ['calendar-invalid day 32', '2026-09-32T00:00:00Z'],
  ])('rejects calendar-invalid window_open_at: %s', (_label, window_open_at) => {
    expect(errorsFor({ window_open_at }).length).toBeGreaterThan(0);
  });

  it('rejects a missing window_close_at', () => {
    const dto = plainToInstance(CreateOfferingDto, {
      artwork_id: VALID.artwork_id,
      low_price_stroops: VALID.low_price_stroops,
      high_price_stroops: VALID.high_price_stroops,
      window_open_at: VALID.window_open_at,
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
