---
status: complete
priority: p2
issue_id: 248
tags: [code-review, performance, reliability, TOV-237, PR-35]
dependencies: [247]
---

# Cache stampede: no single-flight on a cold/expired wallet key

## Problem Statement
On a cold or just-expired key, all concurrent requests for the same wallet miss the cache and each launches the full fan-out. The "~2/min per user" claim is the amortized steady-state rate, not a concurrency bound.

## Findings
Flagged by performance-oracle (P2.1), security-sentinel (P3.2).
- `me-holdings.service.ts:51-52,81`; `holdings-cache.ts`.
- Blast radius is bounded per-identity (owner-scoped by JWT `sub` + 30/60s throttle), so it is one user's own duplicated fan-out (e.g. 5 tabs at TTL expiry → 5× the RPC load), not a platform-wide herd. But it multiplies the todo-247 O(catalog) cost exactly when it is highest.

## Proposed Solutions
1. In-process per-wallet single-flight: `Map<wallet, Promise<HoldingDto[]>>` in `MeHoldingsService` — first caller creates the promise, concurrent callers await it, deleted in `finally`. Collapses same-wallet concurrent fan-outs within an instance. Effort: Small. Risk: low (per-identity affinity makes cross-instance coordination unnecessary).
2. Cross-instance Redis `SET NX` lock (reuse `RedisRelayerAccountLock.withLock`) with a short acquire budget and fall-through-to-read on failure. Effort: Medium. Heavier than needed given stampede is per-identity.
3. Accept for MVP (bounded per-identity), tracked here. Lower priority if todo-247 concurrency/throttle changes land.

## Recommended Action
**RESOLVED — Solution 1.** Added an in-process `Map<wallet, Promise<HoldingDto[]>>` single-flight in `MeHoldingsService.listHoldings`: concurrent same-wallet cache-miss requests share one `loadAndCache` fan-out; the entry is deleted in `finally` (never caches an error). The check-and-set has no `await` between it, so it's atomic on the event loop. Chosen over a cross-instance Redis lock because stampede is per-identity (owner-scoped by JWT `sub`), so in-process coalescing is sufficient.

## Technical Details
- `me-holdings.service.ts` — `inFlight` map + `loadAndCache` extraction. New unit test fires two concurrent `listHoldings` for the same user and asserts `reader.balancesOf` is called once.

## Acceptance Criteria
- [x] Concurrent same-wallet cold-cache requests collapse to a single fan-out (unit-tested).

## Work Log
- 2026-07-18: created from PR #35 review (performance P2.1, security P3.2).
- 2026-07-18: RESOLVED — in-process per-wallet single-flight added; build + 11 service tests + holdings e2e green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
