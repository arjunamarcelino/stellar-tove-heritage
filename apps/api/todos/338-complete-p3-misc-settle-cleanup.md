---
status: complete
priority: p3
issue_id: 338
tags: [code-review, quality, tov-160]
dependencies: []
---
# Misc settle cleanup: low-value `fill` DTO field, N sequential winner UPDATEs, under-selling clearing-walk index comment

## Problem Statement
Three unrelated minor cleanups on the TOV-160 settle path. All are currently acceptable at the MAX_BIDS=40 cap; the notes are about low-value surface area and about comments that mis-describe why the current approach is fine (so a future reader draws the right conclusion if the cap moves).

## Findings
- **(1) LOW-VALUE `fill` FIELD** — `src/modules/offerings/dto/clearing-preview.dto.ts` exposes `fill: 'full' | 'partial'` per row. Low value: the DTO omits `count`, so the client can't recompute fill anyway, and the marginal winner is simply the lowest-price winning row — trivially derivable. Drop `fill` unless the FE genuinely needs a per-row flag. **Confirm FE need before removing.**
- **(2) N SEQUENTIAL SINGLE-ROW UPDATES** — `src/modules/offerings/offering-settle.processor.ts` `persist()`'s `casWon` loop issues up to `MAX_BIDS`=40 sequential single-row UPDATEs inside the settle transaction. Acceptable at cap 40: it runs after both on-chain txs, has no external I/O inside the txn, and `concurrency: 1` means no contention. **But if MAX_BIDS is ever raised**, collapse to a single `UPDATE ... FROM (VALUES ...)` with an `affected == winners.length` guard — mirroring how `flipRemainingEscrowedToLost` already does its set update.
- **(3) UNDER-SOLD CLEARING-WALK INDEX COMMENT** — migration `1716000000039` + `src/modules/offerings/repositories/offering-bid.repository.ts` `listBidsForClearing`: the index `(offering_id, price_stroops DESC, created_at ASC, id ASC) WHERE deleted_at IS NULL` correctly serves the walk with **no Sort node** (verified). But the comment saying "one offering's small book" under-sells the real cost: `status = 'escrowed'` is deliberately **not** in the index predicate (it's mutable → would cause HOT churn), so the plan carries a **residual Filter over ALL non-deleted rows for that offering** (canceled/lost/won accumulate with `deleted_at IS NULL`). That's bounded by cancel throughput (~0.2 tx/s joint lock), so it's acceptable — but the comment should say the Filter scans **bounded churn**, not imply a hard ≤40-row cap.

## Proposed Solutions
### Option A — Do all three
- Description: Remove `fill` (after FE confirmation); leave the UPDATE loop but add a guard-comment tying the "collapse to one UPDATE...FROM(VALUES)" refactor to any MAX_BIDS increase; rewrite the index comment to describe the bounded-churn residual Filter accurately.
- Pros: Smaller DTO surface, accurate comments that guide the next reader correctly.
- Cons: `fill` removal needs FE coordination.
- Effort: Small
- Risk: Low

### Option B — Comments only
- Description: Keep `fill` and the UPDATE loop; only correct the two comments (the MAX_BIDS-raise guidance and the index-walk Filter description).
- Pros: Zero behavior/API change.
- Cons: Leaves the low-value `fill` field.
- Effort: Tiny
- Risk: Low

## Recommended Action
Option A, contingent on FE: confirm whether the FE consumes `fill`; if not, drop it. Regardless, fix both comments — add the "collapse to `UPDATE...FROM(VALUES)` if MAX_BIDS rises" note beside the `casWon` loop, and rewrite the `listBidsForClearing` index comment to state the residual Filter scans bounded churn (not a hard ≤40 cap).

## Technical Details
- The single-UPDATE pattern to mirror: `UPDATE offering_bids AS b SET status='won', ... FROM (VALUES (id, ...), ...) AS v(id, ...) WHERE b.id = v.id`, then assert `affected === winners.length` before commit.
- Why `status` is out of the index predicate: it mutates (`escrowed`→terminal) frequently, so including it would defeat HOT updates and bloat the index; the residual Filter is the deliberate trade-off.

## Acceptance Criteria
- `fill` is removed from `clearing-preview.dto.ts` OR a note records that the FE requires it.
- The `casWon` loop carries a comment specifying the single-batch-UPDATE refactor to apply if MAX_BIDS is raised.
- The `listBidsForClearing` / migration 039 comment accurately describes the bounded-churn residual Filter (no implied ≤40 hard cap) and confirms no Sort node.

## Work Log
- 2026-08-20: created from PR #43 review (kieran-typescript + performance-oracle)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Three grouped cleanups: (1) Dropped the preview `fill: 'full'|'partial'` field (per the review-fix decision) —
it wasn't client-derivable (count is not exposed) and the marginal winner is simply the lowest-price row;
removed from `ClearingAllocationItemDto` + `ClearingPreviewDto.build`. (2) Added a comment on the `persist()`
`casWon` loop documenting the single-`UPDATE … FROM (VALUES …)` batch option should MAX_BIDS ever be raised
materially (acceptable as N sequential UPDATEs at ~tens). (3) Tightened the `listBidsForClearing` comment to
state the residual `Filter: status='escrowed'` scans that offering's non-deleted rows (bounded by cancel
churn, not a hard ≤MAX_BIDS cap), since `status` is deliberately kept out of the partial-index predicate.
Build green.
