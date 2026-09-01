---
status: complete
priority: p2
issue_id: 150
tags: [code-review, architecture, idempotency, TOV-24]
dependencies: []
---

# `IdempotencyStore` is in `common/` but single-consumer, re-declared per module, and coupled to `queueConfig`

## Problem Statement
`IdempotencyStore` sits in `common/idempotency/` (signalling a shared cross-cutting primitive) but currently
has exactly one consumer and is listed directly in `PublicMeWalletsModule.providers` — so each importing
module would instantiate its own. It also reaches directly into `@config/queue.config` for Redis connection
params, coupling a `common/` primitive to the BullMQ/queue config surface (the relayer's analogous Redis lock
lives inside `relayer/`, not `common/`). Either commit to it as a shared primitive (the `auth/CLAUDE.md`
deferred "Idempotency-Key retry" note suggests future reuse) or keep it beside its only consumer.

## Findings
- `src/common/idempotency/idempotency-store.ts` — `@Inject(queueConfig.KEY)`; provided as a bare class in
  `public-me-wallets.module.ts` (not a shared module/global).
- Precedent: `src/modules/relayer/redis-relayer-account-lock.ts` lives in its owning module and is the pattern
  this store mirrors.
- Architecture reviewer (P2).

## Proposed Solutions

### Option A: Commit to shared — extract an `IdempotencyModule` in `common/` + a redis-connection token (recommended if reuse is intended)
Wrap the store in a small `IdempotencyModule` so consumers import one instance; introduce a dedicated
`redis.config` (or an injected `Redis` client/connection token) so the primitive doesn't depend on the queue
module's config identity.
- **Pros:** True shared primitive; decoupled from `queueConfig`; ready for the passkey/auth idempotency reuse.
- **Cons:** More upfront structure for a currently single consumer.
- **Effort:** Small–Medium · **Risk:** Low

### Option B: Keep local — move it under the wallets surface next to `MeWalletsService`
- **Pros:** Honest about current scope (one consumer); no premature sharing.
- **Cons:** Reverses if a second consumer appears soon (likely, per the auth note).
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (commit to shared).

## Implemented Solution
- **`src/common/idempotency/idempotency.module.ts`** — new `IdempotencyModule` that provides + exports a
  single `IdempotencyStore`. `PublicMeWalletsModule` now imports the module instead of re-declaring the
  provider, so all future consumers share one instance/connection.
- **`src/config/redis.config.ts`** — new `registerAs('redis', …)` reading the `REDIS_*` env vars, so the
  `common/` primitive no longer depends on the BullMQ `queue.config` identity. Registered in
  `app.module.ts`'s `ConfigModule.forRoot({ load: [...] })`. The store's constructor now injects
  `redisConfig.KEY`.

Verified: me-wallets e2e (AppModule graph + provider override) green; real-Redis idempotency integration
green; lint/build clean.

## Technical Details
Affected: new `idempotency.module.ts` + `redis.config.ts`; `idempotency-store.ts` (inject redisConfig);
`app.module.ts` (load redisConfig); `public-me-wallets.module.ts` (import IdempotencyModule).

## Acceptance Criteria
- [x] Placement matches intent: shared `IdempotencyModule` (single instance).
- [x] The store's Redis connection config no longer depends on `queueConfig` identity (dedicated `redis.config`).

## Work Log
- 2026-07-15: Filed from PR #26 architecture review (P2).
- 2026-07-15: Extracted `IdempotencyModule` + `redis.config`; store decoupled from `queueConfig`. Green.
