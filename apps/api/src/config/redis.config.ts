import { registerAs } from '@nestjs/config';

/**
 * Redis connection for general-purpose primitives (e.g. the idempotency store), separate from
 * `queue.config` (BullMQ) so a shared `common/` primitive doesn't depend on the queue module's config
 * identity. Reads the same `REDIS_*` env vars — both point at the one Redis instance.
 */
export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
}));

export type RedisConfig = ReturnType<typeof redisConfig>;
