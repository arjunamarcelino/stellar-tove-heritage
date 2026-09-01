---
status: complete
priority: p2
issue_id: 095
tags: [code-review, scalability, availability, relayer, tov-21]
dependencies: []
---

# Relayer Deploy Serialization Is In-Process Only + Unbounded Queue Depth

## Problem Statement
`SorobanRelayerService` serializes deploys through a single instance-level promise chain
(`this.queue`) to avoid `txBAD_SEQ` on the one shared relayer account. Two scale limits:

1. **Breaks under horizontal scaling.** The chain guarantees "one submit at a time" only within a
   single Node process. The relayer keypair is shared config, so with >1 replica (standard NestJS
   deployment) two instances fetch the same account sequence and submit concurrently →
   `txBAD_SEQ` → a fraction of deploys fail as `503 WALLET_DEPLOY_FAILED`.
2. **Unbounded queue depth.** `deployPasskeyWallet` chains every call with no depth cap and no
   queue-wait timeout. `deployTimeoutMs` bounds only a deploy *once it starts*; a request's total
   latency = sum of all deploys ahead of it. Under a burst, `finish` requests accumulate as
   in-flight HTTP handlers → tail-latency blowup / connection exhaustion.

Already partially acknowledged: `auth/CLAUDE.md` marks the endpoint testnet-only and defers a
BullMQ-based deploy path. This todo tracks making it real before production concurrency / scale-out.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:41,55-65` — in-memory `Promise` chain; `getAccount` (sequence fetch) inside `doDeploy`, single-instance only.
- `src/modules/relayer/soroban-relayer.service.ts:55-65` — no queue-depth cap, no wait deadline.
- Flagged by performance-oracle (C1/C2) and security-sentinel (P3, availability).

## Proposed Solutions

### Option A: Distributed single-consumer deploy queue (BullMQ, already in stack)
- Move on-chain deploys to a BullMQ queue with concurrency 1 keyed to the relayer account; `finish`
  enqueues and awaits (or returns `202` + poll — see cons). Fetch the sequence inside the worker.
- **Pros:** Cross-instance serialization; natural retry/backoff; decouples from replica count.
- **Cons:** If kept synchronous, `finish` still holds the request; the clean version is async `202`.
- **Effort:** Medium/Large · **Risk:** Medium

### Option B: Distributed lock around sequence-fetch→submit
- Wrap the critical section in a Redis lock / `pg_advisory_lock` keyed on the relayer account
  (mirrors the `pg_try_advisory_xact_lock` pattern already used in `deleteExpired`).
- **Pros:** Smaller change; keeps synchronous flow. **Cons:** Still holds the HTTP request; lock contention under burst. **Effort:** Medium · **Risk:** Medium

### Option C (interim safety valve): bound queue depth
- Reject with 429/503 past a depth threshold + add a queue-wait deadline, so requests fail fast
  instead of piling up. Ship alongside A/B.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Option B (distributed lock) shipped** 2026-07-03 — a Redis SET-NX lock now serializes the sequence-fetch→submit critical section across instances. (Interim depth-cap / async 202 not needed for testnet volume; async queue remains a future option if throughput demands it.)

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts`, `src/modules/auth/passkey.service.ts` (finish), `src/modules/jobs/`.

## Acceptance Criteria
- [x] Concurrent deploys from 2+ instances do not produce `txBAD_SEQ` (Redis lock serializes across instances).
- [x] Lock acquisition is bounded by a deadline; excess waiters fail fast with `could not acquire the relayer deploy lock`.
- [x] Class doc + module doc updated to describe the cross-instance lock.

## Work Log
- 2026-07-02: Filed from PR #21 code review (performance + security).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-03: RESOLVED via a Redis distributed lock. New `DEPLOY_LOCK` port (`deploy-lock.interface.ts`) + `RedisDeployLock` (SET key token NX PX, spin-acquire with a bounded deadline, Lua compare-and-delete release, `lazyConnect` so tests open no Redis connection) + `InMemoryDeployLock` (single-process fallback/tests). `SorobanRelayerService` now holds the lock only across the sequence-fetch→submit section (poll runs outside); dropped the in-process promise-chain queue. 8 new unit tests (2 adapter guard/collision + 6 lock). Cross-instance `txBAD_SEQ` no longer possible. Build+lint clean; unit 240, integration 30, e2e 60 green.
