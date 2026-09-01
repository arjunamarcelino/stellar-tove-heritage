import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { parseIdempotencyKey } from '../../../src/common/decorators/idempotency-key.decorator';

describe('parseIdempotencyKey', () => {
  it('returns the trimmed key for a valid header', () => {
    expect(parseIdempotencyKey('  abc-123_DEF.4  ')).toBe('abc-123_DEF.4');
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(256)],
    ['bad charset (colon)', 'a:b'],
    ['bad charset (space)', 'a b'],
  ])('rejects %s with 400', (_label, value) => {
    let status: number | undefined;
    try {
      parseIdempotencyKey(value);
    } catch (err) {
      status = (err as HttpException).getStatus();
    }
    expect(status).toBe(400);
  });
});
