---
status: complete
priority: p3
issue_id: 264
tags: [code-review, performance, migration, TOV-152, PR-36]
dependencies: []
---

# FK `RESTRICT` columns are unindexed; no partial index for terminal/soft-deleted rows

## Problem Statement
`offerings` has only two indexes (PK + the partial-unique active-per-artwork). The `ON DELETE RESTRICT` FK on `fraction_contract_id` has no supporting index, so a delete/key-update on a `fraction_contracts` parent must sequential-scan `offerings` to run the RI check. The `artwork_id` RESTRICT check is only partially covered — the partial-unique index's predicate excludes terminal (`settled`/`canceled`) and soft-deleted rows, so it can't serve the RESTRICT scan for those. Impact is bounded (both parents are effectively non-deletable at MVP scale), so this is a latent anti-pattern, not a live problem.

## Findings
Flagged by **data-integrity-guardian (P3)** and **data-migration-expert (P3)**.
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts` — only PK + `UQ_offerings_active_per_artwork` created; no plain FK indexes.
- `src/database/CLAUDE.md` mandates a `WHERE deleted_at IS NULL` partial index for soft-delete tables; the unique index technically carries that predicate but only for active-status `artwork_id` lookups.

## Proposed Solutions
1. Add a plain index on `fraction_contract_id` (covers the RESTRICT scan). Effort: Small. Add only if a parent-delete path is ever anticipated.
2. Add a `WHERE deleted_at IS NULL` partial index on `artwork_id` (all statuses) if offerings will be listed by artwork across terminal statuses (the out-of-scope `me/offerings` / admin-history reads). Effort: Small.
3. Accept the trade-off and document it (as 028 does for its bounded tables) — defer both indexes to the FR that first needs the read/delete path (YAGNI). Effort: trivial.

## Recommended Action
**RESOLVED — Solution 3 (accept + document).** Deferred per YAGNI — both parents are effectively
non-deletable at MVP scale (028's CHK/trigger + the composite FK from todo 259), and the only current
lookup is served by the partial-unique index. Added a NOTE in migration 032 stating the deferral and that
the FR which first adds a parent-delete path or an offerings-by-artwork list must add the matching index.

## Technical Details
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts`.

## Acceptance Criteria
- [x] Decision recorded: defer per YAGNI, trade-off documented in migration 032.

## Work Log
- 2026-08-18: created from PR #36 review (data-integrity-guardian P3, data-migration-expert P3).
- 2026-08-18: RESOLVED — accepted + documented in migration 032 (NOTE on the deferred FK/list indexing). Build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
