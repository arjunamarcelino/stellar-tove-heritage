import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OfferingPreviewQueryDto } from '@modules/backoffice/artworks/dto/offering-preview-query.dto';

/** Mirror the runtime pipe (whitelist + forbidNonWhitelisted); returns true when the DTO is valid. */
function ok(input: Record<string, unknown>): boolean {
  const dto = plainToInstance(OfferingPreviewQueryDto, input);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length === 0;
}

describe('OfferingPreviewQueryDto — all-or-nothing band', () => {
  it('both bounds present and valid → ok (positive)', () => {
    expect(ok({ low_price_stroops: '50000000', high_price_stroops: '150000000' })).toBe(true);
  });

  it('neither bound present → ok, band absent (positive)', () => {
    expect(ok({})).toBe(true);
  });

  it('both empty strings (?low=&high=) → treated as absent → ok (edge)', () => {
    expect(ok({ low_price_stroops: '', high_price_stroops: '' })).toBe(true);
  });

  it.each([
    ['only low present', { low_price_stroops: '5' }],
    ['only high present', { high_price_stroops: '5' }],
    ['low present, high empty', { low_price_stroops: '5', high_price_stroops: '' }],
  ])('%s → invalid (400, both-or-neither) (negative)', (_label, input) => {
    expect(ok(input)).toBe(false);
  });

  it.each([
    ['negative', '-5'],
    ['scientific', '1e3'],
    ['whitespace', ' 5 '],
    ['leading zero', '05'],
    ['decimal', '5.0'],
  ])('malformed integer string (%s) → invalid (400) (negative)', (_label, low) => {
    expect(ok({ low_price_stroops: low, high_price_stroops: '100' })).toBe(false);
  });
});
