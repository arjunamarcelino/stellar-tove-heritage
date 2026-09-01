---
status: complete
priority: p3
issue_id: 358
tags: [code-review, quality, api-contract, tov-172]
dependencies: []
---
# Replay returns two different bodies for the same RFQ (`balance_warning` present via Redis, absent via DB backstop) (PR #46)

## Problem Statement
A Redis-backed idempotency replay (≤24h) returns the stored 201 body *including* any `balance_warning`, while the
durable DB backstop replay (after the 30s in-flight sentinel lapses / Redis eviction) returns
`RfqResponseDto.fromEntity(existing)` *without* it (the warning is ephemeral, never persisted). So a client that
retries the same Idempotency-Key across the Redis TTL boundary can observe the warning appear then disappear for
the same `id`. It is documented as intentional, but it is an observable contract inconsistency.

## Findings
Sources: kieran-typescript-reviewer (P3), security-sentinel (noted). The FE contract (todo #352 / the api-contract
doc) already tells FE never to rely on `balance_warning` presence on a replay — so this is mostly a documentation
consistency item.

- `src/modules/marketplace/rfqs/rfqs.service.ts:69` (Redis replay, `begin.body`) vs `:172` (DB backstop, `fromEntity(existing)`)

## Proposed Solutions
### Option A — Document the divergence in the API contract (lowest effort)
- Description: Ensure `docs/api-contracts/TOV-172-rfq-create.md` explicitly states `balance_warning` is
  present-only-when-fresh and never stable across retries (already partially stated) — and add a code comment at
  both replay sites cross-referencing it.
- Pros: Zero behavior change; matches the "advisory, non-stable" intent.
- Cons: The inconsistency remains, just documented.
- Effort: Small
- Risk: Low

### Option B — Strip `balance_warning` before storing the Redis snapshot
- Description: Store the body WITHOUT `balance_warning` in `idempotency.complete(...)`, so both replay paths
  return an identical warning-free body; only the fresh 201 carries the warning.
- Pros: Both replay paths are byte-identical; the warning becomes strictly a fresh-response concern.
- Cons: A fresh-then-replayed client loses the warning on retry (arguably fine — it's advisory).
- Effort: Small
- Risk: Low

## Recommended Action
Option B — strip `balance_warning` from the stored snapshot. Approved 2026-08-21.

## Resolution
Split the fresh response from the stored replay snapshot in `RfqsService.create`: `stored =
fromEntity(saved)` (warning-free) is persisted via `idempotency.complete(...)`, while the returned `body`
carries `balance_warning` only on the fresh 201. The DB durable-backstop replay already returned the
warning-free entity, so now BOTH replay paths (Redis ≤24h and DB-backstop) return an identical body — the
warning is strictly a first-response concern. Updated the FE contract to state a replay is always
warning-free. Verified: build 0, lint clean, RFQ unit 43/43.

## Technical Details
- Option B requires building the stored snapshot separately from the returned body in `create()`.

## Acceptance Criteria
- [ ] Either the contract explicitly documents the non-stable warning (with code cross-refs), or both replay paths return identical bodies.

## Work Log
- 2026-08-21 — Filed from PR #46 review (kieran-typescript-reviewer).

## Resources
- PR #46; `rfqs.service.ts`; `docs/api-contracts/TOV-172-rfq-create.md`.
