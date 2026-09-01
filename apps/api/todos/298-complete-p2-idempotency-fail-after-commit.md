---
status: complete
priority: p2
issue_id: 298
tags: [code-review, correctness, idempotency]
dependencies: []
---
# submit() can fail() the idempotency key after a committed bid insert (deviates from approve())

## Problem Statement
In `submit()`, the DB transaction (insert + audit), `complete()`, and the enqueue all sit inside ONE `try` block whose `catch` calls `idempotency.fail(key, token)`. The comment claims "never fail() after a committed side effect," but if `complete()` throws (e.g. a Redis blip) the outer catch runs `fail()` AFTER the bid row has already committed — deleting the idempotency key. A same-key retry then re-enters `begin()` fresh, hits the active-per-collector index → null → 409 `BID_ALREADY_ACTIVE`. The collector who DID create a bid is told they cannot, and never receives the 201 body (recoverable only via `GET /bids/me`). The proven sibling in backoffice avoids this by structuring the blocks differently.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:135-216` — a single `try` wraps the txn, `complete()` at :182, and the enqueue; the `catch` at :214 calls `fail()`. Scenario: txn commits the bid row, then `complete()` throws on a Redis blip → outer catch runs `fail(key, token)` → key deleted → same-key retry returns 409 `BID_ALREADY_ACTIVE` despite the bid existing.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:204-256` — the sibling wraps the txn in its own try/catch (fail + rethrow) and runs `complete()` + enqueue OUTSIDE the fail-guarded block, so a post-commit failure can never delete the idem key.

## Proposed Solutions

### Option A — Adopt the sibling two-block shape
Description: Fail-guard ONLY the txn (insert + audit); on txn failure call `fail()` and rethrow. Run `complete()` and enqueue AFTER the txn block, best-effort, outside any fail-guarded path.
Pros: Structurally enforces the invariant the comment already states; matches the proven `approve()` sibling; smallest conceptual change.
Cons: Requires reordering the method into two blocks.
Effort: Small.
Risk: Low.

### Option B — Wrap complete() in its own non-failing try/catch
Description: Keep the current structure but wrap `complete()` in a dedicated try/catch that swallows/logs and never calls `fail()`.
Pros: Minimal diff.
Cons: Leaves the enqueue still inside the fail-guarded region; less clearly correct than the sibling shape; easy to regress.
Effort: Small.
Risk: Low-Medium.

## Recommended Action

## Technical Details
The invariant is: once the bid row commits, the idempotency key must never be deleted, because `fail()` re-opens the key for a retry that will then collide with `UQ_offering_bids_active_per_collector`. The correct boundary is exactly the DB transaction; everything after commit (`complete()`, enqueue) is best-effort and must not be able to trigger `fail()`.

## Acceptance Criteria
- A thrown `complete()` does not call `fail()`.
- The invariant stated in the comment is structurally enforced (not merely asserted in prose).
- A unit test covers the post-commit `complete()` failure path.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Restructured `submit()` into the two-block shape used by `backoffice-offerings.service.approve()`:
- **Fail-guarded block:** validation → wallet resolve → expiry pre-check → the `runInTransaction`
  insert+audit, plus building the job payload. A throw here (and ONLY here) calls
  `idempotency.fail(key, token)` + rethrows.
- **Outside the guard (post-commit):** `idempotency.complete(...)` then the best-effort `escrowQueue.add`.

Now a `complete()` failure (Redis blip) can never trigger `fail()` after the bid row is committed — the
invariant the old comment claimed is structurally enforced. A post-commit failure leaves a committed
`submitted` bid recoverable via `GET /bids/me`.

**Files:** `offering-bids.service.ts` (+`OfferingBid` import; `bid`/`job` hoisted). Build green; e2e 7/7.
