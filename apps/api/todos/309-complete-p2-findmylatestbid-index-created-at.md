---
status: complete
priority: p2
issue_id: 309
tags: [code-review, performance, database, tov-158]
dependencies: []
---
# `findMyLatestBid` sorts unindexed on the hot status-poll path (index lacks `created_at`)

## Problem Statement
`findMyLatestBid` — the `GET :id/bids/me` poll target the FE hits every ~2s while an escrow or cancel is in flight — runs `WHERE (offering_id, collector_sub, deleted_at IS NULL) ORDER BY created_at DESC LIMIT 1`. The new index `IDX_offering_bids_collector (collector_sub, offering_id) WHERE deleted_at IS NULL` covers the equality filter but has no `created_at` column, so Postgres does `Index Scan → Sort → Limit`, not a single index-backed fetch. The code's own comments overstate coverage.

## Findings
- `src/modules/offerings/repositories/offering-bid.repository.ts:147-154` — the query + the inline comment claiming the plain btree serves it.
- `src/database/migrations/1716000000037-AddOfferingBidCancelStates.ts:~137-140` — `IDX_offering_bids_collector` on `(collector_sub, offering_id)` only.
- **Scaling scenario:** because `escrowed → canceling → canceled` frees the active slot and permits an immediate re-bid, a collector on a 7-day offering can accumulate hundreds of terminal (`canceled`/`failed`) rows on one `(collector, offering)` pair. Every 2s poll then re-sorts that growing, adversary-controlled set to return 1 row. Sub-ms today, but it is CPU spent on the feature's most frequent read and grows with history rather than being constant.

## Proposed Solutions
### Option A — Add `created_at DESC` to the index
- Description: `CREATE INDEX "IDX_offering_bids_collector" ON "offering_bids" ("collector_sub", "offering_id", "created_at" DESC) WHERE "deleted_at" IS NULL;` (adjust migration 037, or a follow-up migration 038 if 037 has already deployed anywhere).
- Pros: `findMyLatestBid` becomes an index-ordered `LIMIT 1` (no sort); `findMyActiveBid` (equality-only) is still fully served by the same index — strict improvement.
- Cons: Slightly larger index; if 037 is already applied to a shared DB, needs a new migration.
- Effort: Small
- Risk: Low

### Option B — Leave as-is, fix the comments only
- Description: Accept the sort (tiny N in practice), correct the two overstated comments to "filter served by index; ORDER BY sorts in memory."
- Pros: Zero schema change.
- Cons: Leaves an adversary-growable sort on the hottest read.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — add `created_at DESC` (and the `id` tiebreak) to the index.

## Technical Details
Also consider a deterministic tiebreak: `ORDER BY created_at DESC, id DESC` (and matching index) so the poll target is stable under an exact-timestamp tie. `timestamptz` is microsecond precision and bids serialize, so this is minor.

## Acceptance Criteria
- `findMyLatestBid`'s plan is an Index Scan with no separate Sort node at ≥10^5 rows on one `(collector, offering)` pair (EXPLAIN assertion in the integration suite).
- `findMyActiveBid` remains index-served.
- The repository/migration comments accurately describe index coverage.

## Work Log
- 2026-08-20: created from PR #42 performance-oracle review (+ kieran-typescript tiebreak nit)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20)
Changed `IDX_offering_bids_collector` (migration 037) from `(collector_sub, offering_id)` to
`(collector_sub, offering_id, created_at DESC, id DESC) WHERE deleted_at IS NULL`, so `findMyLatestBid`'s
`ORDER BY created_at DESC, id DESC LIMIT 1` is fully index-ordered (no in-memory Sort). Added the `id DESC`
tiebreak to `findMyLatestBid` for deterministic results under an exact created_at tie (and to the index so it
stays index-served). `findMyActiveBid` (equality-only) is still served by the leading columns. Corrected the
repository/migration comments to describe the coverage accurately.

Locked in with an integration EXPLAIN assertion (`SET LOCAL enable_seqscan=off` on a dedicated queryRunner):
the plan uses `IDX_offering_bids_collector` with NO `Sort` node. Migration 037 edited in place (it had only
been applied to local tove_test and is part of this unmerged PR; test DB dropped + rebuilt to pick it up).
Integration 16/16, build clean.
