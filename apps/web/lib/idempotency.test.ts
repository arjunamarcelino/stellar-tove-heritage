import { describe, it, expect, afterEach, vi } from 'vitest';
import { z } from 'zod/v4';
import { mintIdempotencyKey } from '@/lib/idempotency';

const uuid = z.uuid();

describe('mintIdempotencyKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a valid v4 uuid via crypto.randomUUID (happy path)', () => {
    const key = mintIdempotencyKey();
    expect(uuid.safeParse(key).success).toBe(true);
  });

  it('mints distinct keys across calls', () => {
    expect(mintIdempotencyKey()).not.toBe(mintIdempotencyKey());
  });

  // SEC-L2: the action re-validates the key with z.uuid(). If the getRandomValues fallback (non-secure
  // context, where randomUUID throws) emitted a non-uuid, every submit on that browser would fail-close.
  it('fallback path (randomUUID throws) still yields a z.uuid()-valid key', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('not a secure context');
    });
    const key = mintIdempotencyKey();
    expect(uuid.safeParse(key).success).toBe(true);
  });

  it('last-resort path (randomUUID AND getRandomValues throw) still yields a valid uuid', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('no randomUUID');
    });
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('no getRandomValues');
    });
    const key = mintIdempotencyKey();
    expect(uuid.safeParse(key).success).toBe(true);
  });
});
