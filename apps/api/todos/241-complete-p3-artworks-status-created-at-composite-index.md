---
status: complete
priority: p3
issue_id: 241
tags: [code-review, performance, index, migration, follow-up, TOV-240, PR-34]
dependencies: []
---

# Follow-up: composite partial index for the list's `status IN (...) ORDER BY created_at DESC`

## Problem Statement
The list query `WHERE status IN (...) AND deleted_at IS NULL ORDER BY created_at DESC` is backed only by `IDX_artworks_status` on `(status) WHERE deleted_at IS NULL` (migration `1716000000027:54`). That partial index covers the filter but **not** the ordering, so Postgres does an explicit top-N sort of the matched set on every list request. Negligible at the interim surface's current volume, but degrades as `artworks` grows (compounded by OFFSET pagination). Already called out as a deliberate deferral in the plan's Risks — this todo tracks the follow-up. No migration was intended in this PR.

## Findings
Flagged by performance-oracle (P2, "real but minor"). The `fraction_contracts` batch IN-query is already fully covered by `UQ_fraction_contracts_active_per_artwork` — no index needed there.
- Query origin: `src/modules/backoffice/artworks/backoffice-artworks.service.ts:200-204`.
- Existing index: `src/database/migrations/1716000000027-CreateArtworksTable.ts:54`.

## Proposed Solutions
1. **Add a composite partial index and drop the redundant status-only one** (single migration, when volume warrants):
   ```sql
   CREATE INDEX "IDX_artworks_status_created_at" ON "artworks" ("status", "created_at" DESC)
     WHERE "deleted_at" IS NULL;   -- CONCURRENTLY if the table is populated at deploy time
   -- DROP INDEX "IDX_artworks_status";  (superseded)
   ```
   Serves both the filter and the ordering; also accelerates the `findAndCount` COUNT filter. Effort: Small. Risk: low.
2. Defer until admins report slowness / row count crosses ~tens of thousands. Risk: none near-term.
3. Consider folding into TOV-189 (public browse unification), which will likely reshape these read paths anyway.

## Recommended Action
**RESOLVED** (Solution 1 — user opted to add now, superseding the plan's deferral). Migration `1716000000030-AddArtworksStatusCreatedAtIndex` creates `IDX_artworks_status_created_at (status, created_at DESC) WHERE deleted_at IS NULL` and drops the redundant `IDX_artworks_status`. Guarded `up`/`down` with `lock_timeout`; non-CONCURRENTLY (runs in the migration txn) which is fine on the near-empty table — header notes the CONCURRENTLY out-of-band path if the table is ever large pre-deploy. Test DB re-migrated; feature integration (5) + e2e (16) green. (EXPLAIN still shows seq-scan at ~4 rows — expected planner behavior for a tiny table; the index serves the sort at scale.)

## Technical Details
- New migration only; no application code change. Keep the partial-`WHERE deleted_at IS NULL` house convention.

## Acceptance Criteria
- [ ] `EXPLAIN` on the list query shows an index scan feeding the sort (no standalone Sort node) after the index exists.
- [ ] Redundant `IDX_artworks_status` dropped in the same migration.

## Work Log
- 2026-07-18: created from PR #34 review (performance-oracle); matches the plan's documented deferral.
- 2026-07-18: RESOLVED — added migration 030 (composite partial index, drops the status-only one). Build clean; test DB re-migrated; integration 5/5 + e2e 16/16 green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
- Plan Risks section: `docs/plans/2026-07-18-feat-admin-artwork-read-endpoints-plan.md`
