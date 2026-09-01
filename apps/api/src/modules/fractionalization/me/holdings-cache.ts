import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisConfig } from '@config/redis.config';
import { fractionReadConfig } from '@config/fraction-read.config';
import { HoldingDto } from './dto/holding.dto';

/**
 * Per-wallet 30s cache for the holdings read (TOV-237). Its own `ioredis` client (no shared Redis module
 * exists; mirrors `IdempotencyStore`), but tuned to **fail fast + fail open**: unlike BullMQ's
 * `maxRetriesPerRequest: null` (which would hang the HTTP request while Redis is down), a Redis outage
 * here rejects immediately and the caller falls through to a live on-chain read. The cache is only an
 * optimization — never a correctness dependency. Keyed on the SERVER-RESOLVED wallet address, so no
 * request field can influence the key; wallet addresses are globally unique among live wallets.
 *
 * Address-keying (NOT userId-keying) is deliberate (todo 254): a primary-wallet reassignment naturally
 * resolves the new address -> a fresh key, so there is no cross-user/cross-wallet leak and no invalidation
 * hook is required. The only residual is a <=TTL stale window if a wallet is demoted then re-promoted within
 * the 30s TTL - bounded and tolerated (the value is on-chain-owned by the address, advisory-only).
 */
@Injectable()
export class HoldingsCache implements OnModuleDestroy {
  private readonly logger = new Logger(HoldingsCache.name);
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(
    @Inject(redisConfig.KEY) redisCfg: ConfigType<typeof redisConfig>,
    @Inject(fractionReadConfig.KEY) readCfg: ConfigType<typeof fractionReadConfig>,
  ) {
    this.ttlSeconds = readCfg.cacheTtlSeconds;
    this.redis = new Redis({
      host: redisCfg.host,
      port: redisCfg.port,
      password: redisCfg.password,
      lazyConnect: true,
      enableOfflineQueue: false, // reject while disconnected → fall through to a live read
      maxRetriesPerRequest: 1, // fail fast (NOT null)
      connectTimeout: 1000,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // An unhandled 'error' event on an ioredis client crashes the process — swallow to fail open.
    this.redis.on('error', (err) => this.logger.warn(`holdings cache redis error (failing open): ${err}`));
  }

  private key(wallet: string): string {
    return `me:holdings:${wallet}`;
  }

  /** Cached holdings for `wallet`, or `null` on miss / malformed value / any Redis error (fail-open). */
  async get(wallet: string): Promise<HoldingDto[] | null> {
    try {
      const raw = await this.redis.get(this.key(wallet));
      if (raw === null) return null;
      // The cache is an untrusted boundary (poisoned/truncated/version-skewed value). `JSON.parse` is
      // `any`; guard the shape and fail open to a live read on anything unexpected.
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed as HoldingDto[];
    } catch (err) {
      this.logger.warn(`holdings cache get failed (failing open): ${String(err)}`);
      return null;
    }
  }

  /** Best-effort cache write with the configured TTL; errors are swallowed (non-fatal). */
  async set(wallet: string, holdings: HoldingDto[]): Promise<void> {
    try {
      await this.redis.set(this.key(wallet), JSON.stringify(holdings), 'EX', this.ttlSeconds);
    } catch (err) {
      this.logger.warn(`holdings cache set failed: ${String(err)}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
