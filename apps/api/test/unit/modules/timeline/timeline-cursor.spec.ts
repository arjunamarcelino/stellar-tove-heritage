import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { encodeCursor, decodeCursor } from '@modules/timeline/timeline-cursor';

const UUID = '00000000-0000-4000-8000-00000000abcd';

describe('timeline-cursor', () => {
  it('round-trips a position (positive)', () => {
    const pos = { occurredAtMs: 1_750_000_000_123, id: UUID };
    const decoded = decodeCursor(encodeCursor(pos));
    expect(decoded).toEqual(pos);
  });

  it('preserves exact ms at a tie boundary (edge)', () => {
    const a = { occurredAtMs: 1_750_000_000_500, id: '00000000-0000-4000-8000-00000000aaaa' };
    const b = { occurredAtMs: 1_750_000_000_500, id: '00000000-0000-4000-8000-00000000bbbb' };
    expect(decodeCursor(encodeCursor(a))).toEqual(a);
    expect(decodeCursor(encodeCursor(b))).toEqual(b);
    // Same ms, different id → distinct cursors (the id tiebreak survives the round-trip).
    expect(encodeCursor(a)).not.toBe(encodeCursor(b));
  });

  it('rejects non-base64url / non-JSON garbage (negative)', () => {
    expect(() => decodeCursor('!!!not base64!!!')).toThrow(BadRequestException);
    expect(() => decodeCursor(Buffer.from('not json', 'utf8').toString('base64url'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a tampered non-integer occurredAt (negative)', () => {
    const tampered = Buffer.from(JSON.stringify({ v: 1, o: 1.5, i: UUID }), 'utf8').toString('base64url');
    expect(() => decodeCursor(tampered)).toThrow(BadRequestException);
  });

  it('rejects a tampered non-uuid id (negative)', () => {
    const tampered = Buffer.from(JSON.stringify({ v: 1, o: 1000, i: 'not-a-uuid' }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(tampered)).toThrow(BadRequestException);
  });

  it('rejects a wrong version / negative offset (negative)', () => {
    const wrongVersion = Buffer.from(JSON.stringify({ v: 99, o: 1000, i: UUID }), 'utf8').toString('base64url');
    const negative = Buffer.from(JSON.stringify({ v: 1, o: -1, i: UUID }), 'utf8').toString('base64url');
    expect(() => decodeCursor(wrongVersion)).toThrow(BadRequestException);
    expect(() => decodeCursor(negative)).toThrow(BadRequestException);
  });

  it('rejects an out-of-Date-range `o` with 400, not a downstream RangeError→500 (#399, edge)', () => {
    // Structurally valid, ≤512 chars, passes base64url — but `new Date(1e16)` would throw RangeError.
    const huge = Buffer.from(JSON.stringify({ v: 1, o: 1e16, i: UUID }), 'utf8').toString('base64url');
    expect(() => decodeCursor(huge)).toThrow(BadRequestException);
    // The exact JS Date ceiling round-trips fine (boundary is inclusive).
    const atMax = { occurredAtMs: 8_640_000_000_000_000, id: UUID };
    expect(decodeCursor(encodeCursor(atMax))).toEqual(atMax);
    // One past the ceiling → 400.
    const overMax = Buffer.from(JSON.stringify({ v: 1, o: 8_640_000_000_000_001, i: UUID }), 'utf8').toString('base64url');
    expect(() => decodeCursor(overMax)).toThrow(BadRequestException);
  });

  it('sets errorCode TIMELINE_INVALID_CURSOR on the 400 body', () => {
    try {
      decodeCursor('###');
      expect.unreachable();
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as { errorCode?: string };
      expect(body.errorCode).toBe('TIMELINE_INVALID_CURSOR');
    }
  });
});
