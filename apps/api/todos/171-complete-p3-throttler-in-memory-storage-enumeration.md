---
status: complete
priority: p3
issue_id: 171
tags: [code-review, security, rate-limiting, cross-cutting, handle, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (Redis-backed throttler storage). Added `@nest-lab/throttler-storage-redis@1.2.0`
(peer `ioredis` already present) and wired `ThrottlerModule.forRootAsync` in `app.module.ts` to return
`{ throttlers: [...], storage: new ThrottlerStorageRedisService(new Redis({...redisConfig, lazyConnect:true, maxRetriesPerRequest:null})) }`.
Rate-limit counters now live in Redis, so per-route `@Throttle` limits (notably the public
`/handles/check` anti-enumeration 30/60s, and the 10/60s write limit) are **shared across app instances
and survive restarts** instead of being per-process in-memory.

- Reused the exact `IdempotencyStore` ioredis options incl. `lazyConnect: true` — so e2e tests that
  `.overrideProvider(ThrottlerStorage)` with a no-op never open a Redis connection (verified: handle +
  me-wallets + auth e2e, 35 tests, exit clean, no hang).
- No new env vars — reuses the already-validated `redisConfig`. Redis is already a hard app dependency
  (idempotency store, BullMQ), so this introduces no new availability class.
- Build clean (TSC 0 issues). The Redis storage path itself is exercised in production; tests override
  the storage by design (per the existing e2e convention).

# Throttler uses in-memory storage — public `/handles/check` enumeration limit is per-instance, not global

## Problem Statement
`ThrottlerModule` is configured without a `storage:`, so it defaults to per-process in-memory
`ThrottlerStorageService`. The `@Throttle({ ttl: 60000, limit: 30 })` on the public
`GET /api/v1/handles/check` (its explicit anti-enumeration control) and the `10/60s` write limit are
therefore enforced **per app instance**. Behind a load balancer with N instances, an attacker gets
effectively N×30 checks/min, weakening the enumeration control the endpoint's comment relies on; limits
also reset on every deploy/restart.

This is a **pre-existing, cross-cutting** platform choice (not introduced by TOV-26) — but the handle
check is a new public surface that leans on it. Redis is already a dependency (BullMQ) but not wired into
the throttler. No `replicas`/`scale` directive was found in the compose files, so single-instance
deployments are currently unaffected — hence P3.

## Findings
- `src/app.module.ts` — `ThrottlerModule.forRootAsync(...)` provides no `storage`, defaulting to in-memory.
- `src/modules/users/handle/handles.controller.ts:10-13,22` — public check relies on the 30/60s IP limit as
  its stated anti-enumeration mitigation.
- Redis is present (`@config/redis.config`, BullMQ) but unused by the throttler.

## Proposed Solutions
### Option A: Back the throttler with Redis
- Use `@nest-lab/throttler-storage-redis` (or a `ThrottlerStorageRedisService`) on the existing Redis
  connection so limits are shared across instances and survive restarts.
- **Pros:** the rate limit becomes real under horizontal scaling. **Cons:** cross-cutting change; affects
  all throttled routes; adds a dep + Redis dependency on the request path. **Effort: Medium.**

### Option B: Accept as-is while single-instance
- Document that rate limits are per-instance and revisit before scaling out.
- **Pros:** no change. **Cons:** the enumeration control silently weakens the day a second instance is added.
  **Effort: None.**

## Recommended Action
_(triage — platform-level; track separately from TOV-26. Enumeration on a pseudonymous handle namespace is
an accepted trade-off, so this is hardening, not a blocker.)_

## Technical Details
- Files: `src/app.module.ts` (throttler storage wiring); a new storage provider using `@config/redis.config`.
- Related policy note (perf + security agents): if handle-existence privacy ever matters, also consider
  lowering the check limit to ~10–15/60s or caching negative (`available:true`) lookups.

## Acceptance Criteria
- [ ] Decision recorded; if pursued, throttler storage is Redis-backed so limits are shared across instances.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (security-sentinel, performance-oracle). Pre-existing/
  cross-cutting; single-instance unaffected today.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
- Related: `todos/165-complete-p3-per-user-throttling-me-wallets.md` (prior throttler hardening)
