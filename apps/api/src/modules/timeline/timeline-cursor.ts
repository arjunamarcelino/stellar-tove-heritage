import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ErrorCode } from '@common/enums/error-code.enum';

/**
 * Opaque keyset cursor for the artwork timeline (TOV-191). base64url(JSON `{ v, o, i }`) where `o` is the
 * last row's `occurred_at` as epoch **ms** (int) and `i` is its uuid. `v` versions the shape so it can evolve
 * without invalidating outstanding cursors. Deliberately UNSIGNED: the payload encodes only the ordering
 * coordinate of a PUBLIC timeline, so a forged cursor can at worst return a valid-but-odd page — never a leak
 * (the WHERE re-applies `artwork_id` + the tier filter from the request every call). Malformed → 400.
 */
const CURSOR_VERSION = 1;

// JS `Date` is valid only within ±8.64e15 ms; `new Date(o).toISOString()` throws `RangeError` beyond that.
// The cursor's epoch-ms is bounded to [0, MAX] so a tampered/out-of-range `o` is a clean 400 here, never an
// uncaught RangeError → 500 at the repo's `new Date(o).toISOString()`. Forward-only: negative epochs are
// rejected (all current emitters stamp forward-of-epoch); revisit if backdated pre-1970 events are emitted.
const MAX_CURSOR_EPOCH_MS = 8_640_000_000_000_000;

export interface CursorPosition {
  occurredAtMs: number;
  id: string;
}

interface CursorPayload {
  v: number;
  o: number;
  i: string;
}

function invalidCursor(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Invalid timeline cursor',
    errorCode: ErrorCode.TIMELINE_INVALID_CURSOR,
  });
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c.v === CURSOR_VERSION &&
    typeof c.o === 'number' &&
    Number.isSafeInteger(c.o) &&
    c.o >= 0 &&
    c.o <= MAX_CURSOR_EPOCH_MS &&
    typeof c.i === 'string' &&
    isUUID(c.i)
  );
}

export function encodeCursor(position: CursorPosition): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, o: position.occurredAtMs, i: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decode + strictly validate. A tampered `{o:1.5}` / non-uuid `i` / non-JSON all throw a clean 400. */
export function decodeCursor(raw: string): CursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!isCursorPayload(parsed)) {
    throw invalidCursor();
  }
  return { occurredAtMs: parsed.o, id: parsed.i };
}
