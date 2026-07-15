import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { queueConfig } from '@config/queue.config';
import { IRelayerAccountLock } from './relayer-account-lock.interface';

/**
 * Cross-instance relayer-account lock via Redis `SET key token NX PX ttl`. Serializes every
 * sequence-consuming submission (deploy AND transfer) on the shared relayer account. Acquisition
 * spins with a bounded wait; release is a compare-and-delete (Lua) so only the holder frees it.
 * `lazyConnect` means the client only connects on first use — in tests (where the relayer port is
 * overridden by a fake) no Redis connection is ever opened.
 */
@Injectable()
export class RedisRelayerAccountLock implements IRelayerAccountLock, OnModuleDestroy {
  private readonly logger = new Logger(RedisRelayerAccountLock.name);
  private readonly redis: Redis;

  private static readonly RETRY_MS = 75;
  private static readonly RELEASE =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

  constructor(
    @Inject(queueConfig.KEY)
    cfg: ConfigType<typeof queueConfig>,
  ) {
    this.redis = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + ttlMs * 2;
    while ((await this.redis.set(key, token, 'PX', ttlMs, 'NX')) === null) {
      if (Date.now() >= deadline) {
        throw new Error('could not acquire the relayer account lock');
      }
      await new Promise((resolve) => setTimeout(resolve, RedisRelayerAccountLock.RETRY_MS));
    }
    try {
      return await fn();
    } finally {
      try {
        await this.redis.eval(RedisRelayerAccountLock.RELEASE, 1, key, token);
      } catch (err) {
        // Not fatal: the lock auto-expires at ttl. Log and move on.
        this.logger.warn(`relayer account lock release failed: ${String(err)}`);
      }
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
