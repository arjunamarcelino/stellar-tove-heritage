import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryRelayerAccountLock } from '../../../../src/modules/relayer/in-memory-relayer-account-lock';

// Minimal in-memory ioredis stand-in with real SET-NX / compare-and-delete semantics.
vi.mock('ioredis', () => {
  class Redis {
    private store = new Map<string, string>();
    set = vi.fn(
      (key: string, val: string): Promise<'OK' | null> =>
        Promise.resolve(this.store.has(key) ? null : (this.store.set(key, val), 'OK')),
    );
    eval = vi.fn((_script: string, _numKeys: number, key: string, token: string): Promise<number> => {
      if (this.store.get(key) === token) {
        this.store.delete(key);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    });
    disconnect = vi.fn();
  }
  return { Redis };
});

const { RedisRelayerAccountLock } = await import('../../../../src/modules/relayer/redis-relayer-account-lock');
const makeRedisLock = () => new RedisRelayerAccountLock({ host: 'localhost', port: 6379, password: undefined });

// Runs `fn` under the lock while tracking peak concurrency across calls.
async function serializes(
  withLock: <T>(k: string, ttl: number, fn: () => Promise<T>) => Promise<T>,
  key: string,
): Promise<number> {
  let active = 0;
  let peak = 0;
  const task = () =>
    withLock(key, 1000, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
  await Promise.all([task(), task(), task()]);
  return peak;
}

describe('InMemoryRelayerAccountLock', () => {
  it('serializes concurrent tasks on the same key (peak concurrency 1)', async () => {
    const lock = new InMemoryRelayerAccountLock();
    expect(await serializes((k, t, f) => lock.withLock(k, t, f), 'same')).toBe(1);
  });

  it('returns the wrapped function result', async () => {
    const lock = new InMemoryRelayerAccountLock();
    await expect(lock.withLock('k', 1000, () => Promise.resolve(42))).resolves.toBe(42);
  });
});

describe('RedisRelayerAccountLock', () => {
  let lock: InstanceType<typeof RedisRelayerAccountLock>;

  beforeEach(() => {
    lock = makeRedisLock();
  });

  it('acquires (SET NX), runs fn, and releases (compare-and-delete)', async () => {
    const result = await lock.withLock('key', 1000, () => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  it('serializes concurrent holders of the same key (peak concurrency 1)', async () => {
    expect(await serializes((k, t, f) => lock.withLock(k, t, f), 'key')).toBe(1);
  });

  it('releases the lock even when the wrapped function throws', async () => {
    await expect(lock.withLock('key', 1000, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    // Lock is free again -> a subsequent acquire succeeds.
    await expect(lock.withLock('key', 1000, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('throws when the lock cannot be acquired within the deadline', async () => {
    // Hold the lock in the background so contenders can never acquire it.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const holder = lock.withLock('key', 10, () => held);
    await new Promise((r) => setTimeout(r, 1));
    await expect(lock.withLock('key', 10, () => Promise.resolve('never'))).rejects.toThrow(
      /could not acquire/,
    );
    release();
    await holder;
  });
});
