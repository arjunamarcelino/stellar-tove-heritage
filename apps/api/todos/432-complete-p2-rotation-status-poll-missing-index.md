---
status: complete
priority: p2
issue_id: 432
tags: [code-review, tov-33, pr-56, performance, index]
dependencies: []
---
# `/status` poll seq-scans `wallet_rotation_transfers` (no covering index for the all-status latest lookup)

## Resolution (2026-08-27) — Solution 1 (add the covering index)
- **Migration `1716000000056-AddWalletRotationSourceLatestIndex.ts`**: partial
  `IDX_wrt_source_latest (source_wallet_id, created_at DESC) WHERE deleted_at IS NULL` — serves the all-status
  `findLatestBySourceWithItems` poll (the partial `UQ_wrt_source_active` couldn't, being `status<>'completed'`).
  New empty table → plain CREATE INDEX, no CONCURRENTLY. Verified present in tove_test; `yarn db:test:setup` re-run.

## Problem Statement
The FE reconciliation **poll** endpoint `GET :id/rotate-transfer/status` runs an all-status "latest rotation for
this source" query that no index covers, so it falls back to a sequential scan on a table that grows by one row per
lifetime rotation platform-wide — on a frequently-polled path.

## Findings
- `findLatestBySourceWithItems` (`wallet-rotation.repository.ts:38-44`) →
  `source_wallet_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1` (**all statuses**), driving
  `status()` (`wallet-rotation.service.ts:384`).
- The only indexes on `wallet_rotation_transfers` (migration 053) are the partial-unique `UQ_wrt_source_active`
  (predicate `status <> 'completed'` → **not usable** for an all-status query) and `IDX_wrt_user_id`. There is no
  `source_wallet_id`-keyed index covering completed rows. A completed rotation leaves the active partial index, so
  the poll seq-scans by `source_wallet_id` on a globally-growing table. (performance-oracle P2)

## Proposed Solutions
1. **Add `CREATE INDEX "IDX_wrt_source_latest" ON wallet_rotation_transfers (source_wallet_id, created_at DESC)
   WHERE deleted_at IS NULL`** — inline in migration 053 (new empty table, no CONCURRENTLY needed). Serves the
   poll exactly. Effort: Small. Recommended.
2. Accept (fine at MVP scale; revisit when rotation volume grows). Cons: a poll path on a growing table with no
   index is a latent scaling cliff.

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] `EXPLAIN` of the status-poll query uses an index (not a seq scan) after the change.
- [ ] Re-run `yarn db:test:setup` (migration 053 edited).

## Resources
- PR #56; reviewer: performance-oracle. Related ceilings (not this ticket): P2-1 platform-wide enumerate, P2-3
  serialized N-transfer drain — both documented as inherited from the TOV-237/export pattern.
