---
status: complete
priority: p3
issue_id: 316
tags: [code-review, performance, simplicity, tov-158]
dependencies: []
---
# Redundant `findOneOrFail` re-read after `casCanceling` in `cancel()`

## Problem Statement
Inside the cancel transaction, after `casCanceling` succeeds, `cancel()` issues an extra `manager.getRepository(OfferingBid).findOneOrFail({ where: { id } })` purely to build the 202 response body reflecting `status='canceling'`. Unlike `insertSubmitted` (which must re-read to pick up the DB-generated `escrow_amount_stroops`), there is no generated column here, so the re-read is avoidable.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:~333` — the `findOneOrFail` re-read after the CAS.
- Cost is negligible (PK lookup on an operation already gated at ~0.2 tx/s), so this is a micro-cleanup, not a perf problem.

## Proposed Solutions
### Option A — `casCanceling` returns the updated row via `.returning([...])`
- Description: Have `casCanceling` return the row (or the fields needed) so no separate read is required.
- Pros: One fewer DB round-trip; keeps the response construction next to the CAS.
- Cons: Changes the repo method's return shape (currently `boolean`); ripples to callers/tests.
- Effort: Small
- Risk: Low

### Option B — Project the already-loaded `bid` in memory with `status='canceling'`
- Description: Build the body from the `bid` entity loaded in `assertCancelable`, overriding `status` to `'canceling'` (and leaving refund stamps null), skipping the read.
- Pros: No extra query, no repo signature change.
- Cons: Hand-constructs the response state rather than reading the source of truth (minor drift risk if the entity gains fields).
- Effort: Small
- Risk: Low

### Option C — Leave as-is
- Description: Accept the one PK read for source-of-truth accuracy.
- Pros: Response always reflects the committed row.
- Cons: One avoidable round-trip.
- Effort: —
- Risk: —

## Recommended Action
Option B — project the already-loaded entity in memory (no extra read, no repo signature change).

## Technical Details
Optional. Safe as-is; only worth doing if the DB shows up in traces or `casCanceling` is refactored for another reason.

## Acceptance Criteria
- If changed: the 202 body still reports `status='canceling'` with null refund stamps and no separate read is issued.

## Work Log
- 2026-08-20: created from PR #42 performance-oracle review (P3)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20)
Removed the `manager.getRepository(OfferingBid).findOneOrFail(...)` re-read after `casCanceling`. The row is
`canceling` once the CAS wins and no generated column changed (unlike `insertSubmitted`), so the 202 body is
built by projecting the already-loaded entity in memory (`bid.status = 'canceling'`; refund stamps are null on
the pre-cancel row). One fewer DB round-trip on the cancel path. Verified end-to-end: cancel e2e 6/6 (AC-1
still reaches `canceled` with the refund hash), service unit 32/32, build + lint clean. (Also fixed an
unrelated `no-unsafe-assignment` lint error in the todo-309 EXPLAIN test's `qr.query` cast, surfaced by this
run.)
