import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import type { RedisConfig } from '@config/redis.config';

/**
 * Exercises the real Redis-backed store (localhost) — the in-memory fake can't surface the cjson
 * round-trip issue fixed in TOV-24 #146. Uses unique keys (24h TTL self-cleans) so no teardown is needed.
 */
const cfg: RedisConfig = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

describe('IdempotencyStore (real Redis)', () => {
  let store: IdempotencyStore;

  beforeAll(() => {
    store = new IdempotencyStore(cfg);
  });

  afterAll(() => {
    store.onModuleDestroy();
  });

  it('claims, then replays the stored body on a same-fingerprint retry', async () => {
    const key = `test:idem:${randomUUID()}`;
    const begin = await store.begin(key, 'fp-a');
    expect(begin.outcome).toBe('proceed');
    if (begin.outcome !== 'proceed') return;

    await store.complete(key, begin.token, { walletId: 'w-1' });

    const replay = await store.begin(key, 'fp-a');
    expect(replay).toEqual({ outcome: 'replay', body: { walletId: 'w-1' } });
  });

  it('replays object / empty-object / large-number bodies unchanged (no cjson corruption) [#146]', async () => {
    const key = `test:idem:${randomUUID()}`;
    const begin = await store.begin(key, 'fp-b');
    if (begin.outcome !== 'proceed') throw new Error('expected proceed');

    // {} would re-emit as [] and big ints lose precision if the body went through Redis cjson.
    const body = { walletId: 'w-2', count: 90071992547409, empty: {}, flag: false };
    await store.complete(key, begin.token, body);

    const replay = await store.begin(key, 'fp-b');
    expect(replay.outcome).toBe('replay');
    if (replay.outcome === 'replay') expect(replay.body).toEqual(body);
  });

  it('returns in_flight for a pending duplicate and mismatch for a different fingerprint', async () => {
    const key = `test:idem:${randomUUID()}`;
    const first = await store.begin(key, 'fp-c');
    expect(first.outcome).toBe('proceed');

    expect((await store.begin(key, 'fp-c')).outcome).toBe('in_flight');
    expect((await store.begin(key, 'fp-different')).outcome).toBe('mismatch');
  });

  it('releases the key on fail so a retry can re-claim', async () => {
    const key = `test:idem:${randomUUID()}`;
    const first = await store.begin(key, 'fp-d');
    if (first.outcome !== 'proceed') throw new Error('expected proceed');
    await store.fail(key, first.token);
    expect((await store.begin(key, 'fp-d')).outcome).toBe('proceed');
  });
});
