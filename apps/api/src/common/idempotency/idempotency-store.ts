import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { redisConfig } from '@config/redis.config';

/**
 * Outcome of {@link IdempotencyStore.begin} for an `Idempotency-Key`:
 * - `proceed` — this request claimed the key; run the handler, then `complete`/`fail` with `token`.
 * - `in_flight` — an identical request is still processing (→ 409).
 * - `mismatch` — the key was reused with a DIFFERENT body (→ 422).
 * - `replay` — the original request already completed; return its stored `body` (→ replay the 201).
 */
export type IdempotencyBegin =
  | { outcome: 'proceed'; token: string }
  | { outcome: 'in_flight' }
  | { outcome: 'mismatch' }
  | { outcome: 'replay'; body: unknown };

interface StoredRecord {
  s: 'pending' | 'done';
  f: string; // body fingerprint (sha-256 hex)
  t: string; // owner token (guards complete/fail against a stale winner)
  b?: string; // completed response body, kept as an opaque JSON STRING (never re-decoded server-side)
}

/**
 * Redis-backed HTTP idempotency store (TOV-24), mirroring `redis-relayer-account-lock.ts`
 * (`SET key val NX PX` claim + token-guarded Lua compare-and-set). Modeled on the IETF
 * Idempotency-Key draft + Stripe: a short-lived `PENDING` sentinel (a crash can only wedge the key for
 * the in-flight TTL, not the 24h retention), a body fingerprint (same key + different body → mismatch),
 * and delete-on-failure so a genuinely failed request can be retried. Callers already scope the key by
 * the authenticated `sub`, so records never collide across users.
 *
 * `lazyConnect` means no Redis connection opens until first use — in tests the provider is overridden
 * with an in-memory fake, so no connection is ever made.
 */
@Injectable()
export class IdempotencyStore implements OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyStore.name);
  private readonly redis: Redis;

  /** In-flight sentinel lifetime: bounds a crash-wedge to seconds, generous vs. a bind's worst case. */
  private static readonly INFLIGHT_TTL_MS = 30_000;
  /** Completed-record retention (published idempotency window). */
  private static readonly COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
  /** Bound on the (rare) claim/expiry race retries in `begin`. */
  private static readonly MAX_CLAIM_ATTEMPTS = 3;

  // Claim-or-classify in ONE round trip: SET NX (claim); on failure GET the existing record and return it
  // for the caller to classify. Collapses the contended replay/in-flight path from 2 RTT → 1.
  private static readonly BEGIN =
    "if redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[2],'NX') then return 'PROCEED' end; " +
    "local raw=redis.call('get',KEYS[1]); if not raw then return 'RETRY' end; return raw";

  // Token-guarded: only the owner (matching `t`) may finalize, so a stale winner whose sentinel expired
  // and was re-claimed cannot clobber the newer record. `b` is stored as the raw JSON STRING (ARGV[2]) —
  // NOT cjson.decode'd — so Redis's cjson never round-trips the body value (its `{}`→`[]` / big-int
  // divergences from JSON.parse can't corrupt it). The record then holds only strings, so the outer
  // cjson.encode is lossless too.
  private static readonly COMPLETE =
    "local raw=redis.call('get',KEYS[1]); if not raw then return 0 end; " +
    'local ok=cjson.decode(raw); if ok.t~=ARGV[1] then return 0 end; ' +
    "ok.s='done'; ok.b=ARGV[2]; " +
    "redis.call('set',KEYS[1],cjson.encode(ok),'PX',ARGV[3]); return 1";
  private static readonly FAIL =
    "local raw=redis.call('get',KEYS[1]); if not raw then return 0 end; " +
    "local ok=cjson.decode(raw); if ok.t==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

  constructor(
    @Inject(redisConfig.KEY)
    cfg: ConfigType<typeof redisConfig>,
  ) {
    this.redis = new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  /** Atomically claim `key`, or classify an existing record against `fingerprint` (single round trip). */
  async begin(key: string, fingerprint: string): Promise<IdempotencyBegin> {
    for (let attempt = 0; attempt < IdempotencyStore.MAX_CLAIM_ATTEMPTS; attempt++) {
      const token = randomUUID();
      const pending: StoredRecord = { s: 'pending', f: fingerprint, t: token };
      const res = (await this.redis.eval(
        IdempotencyStore.BEGIN,
        1,
        key,
        JSON.stringify(pending),
        String(IdempotencyStore.INFLIGHT_TTL_MS),
      )) as string;

      if (res === 'PROCEED') return { outcome: 'proceed', token };
      if (res === 'RETRY') continue; // rare: existing record expired mid-EVAL — re-claim

      const record = JSON.parse(res) as StoredRecord;
      if (record.f !== fingerprint) return { outcome: 'mismatch' };
      if (record.s === 'pending') return { outcome: 'in_flight' };
      // `record.b` is the opaque JSON string stored by complete() — parse it back to the response body.
      return { outcome: 'replay', body: record.b === undefined ? undefined : JSON.parse(record.b) };
    }
    // Contended expiry loop — treat as in-flight so the client retries rather than double-creating.
    return { outcome: 'in_flight' };
  }

  /**
   * Persist the successful response under `key` (token-guarded), extending retention to 24h. Non-fatal:
   * the wallet was already committed before this call, so a Redis failure here must NOT surface as a 500
   * for a successful bind — log and move on (a same-key retry then re-runs and hits ALREADY_USED, and the
   * bound wallet is still visible via GET /me/wallets).
   */
  async complete(key: string, token: string, body: unknown): Promise<void> {
    try {
      await this.redis.eval(
        IdempotencyStore.COMPLETE,
        1,
        key,
        token,
        JSON.stringify(body),
        String(IdempotencyStore.COMPLETED_TTL_MS),
      );
    } catch (err) {
      this.logger.warn(`idempotency key complete failed (bind already committed): ${String(err)}`);
    }
  }

  /** Release `key` after a failed handler (token-guarded) so the request can be retried. */
  async fail(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(IdempotencyStore.FAIL, 1, key, token);
    } catch (err) {
      // Not fatal: the sentinel auto-expires at the in-flight TTL. Log and move on.
      this.logger.warn(`idempotency key release failed: ${String(err)}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
