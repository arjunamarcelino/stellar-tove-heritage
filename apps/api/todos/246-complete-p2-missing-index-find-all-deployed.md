---
status: complete
priority: p2
issue_id: 246
tags: [code-review, performance, database, migration, TOV-237, PR-35]
dependencies: []
---

# No index supports `findAllDeployed` (`WHERE status='deployed' AND deleted_at IS NULL`)

## Problem Statement
The hottest read on the collector dashboard runs a table scan of `fraction_contracts` on every cache miss. Invisible at MVP scale, a guaranteed seq-scan at 1k–10k deployed contracts.

## Findings
Flagged by performance-oracle (rated P1 by the agent; scoped P2 here because the table is near-empty today and the scan is dwarfed by the RPC fan-out that follows).
- Query: `src/modules/fractionalization/repositories/fraction-contract.repository.ts:34-38` — `find({ where: { status: 'deployed', deletedAt: IsNull() } })`.
- Migration `1716000000028-CreateFractionContractsTable.ts:63-73` has only: `UQ_fraction_contracts_active_per_artwork` (partial `status IN ('deploying','deployed')`, keyed on `artwork_id` — no status selectivity) and `IDX_fc_deploying_created_at` (partial `status='deploying'`, irrelevant). No index whose predicate is `status='deployed' AND deleted_at IS NULL`.

## Proposed Solutions
1. Add a partial covering index (new migration, next number `1716000000031`):
   ```sql
   CREATE INDEX "IDX_fc_deployed" ON "fraction_contracts" ("artwork_id","token_address")
     WHERE "status" = 'deployed' AND "deleted_at" IS NULL;
   ```
   Keys on the two columns `buildHoldings` consumes → index-only scan; partial predicate keeps it small. Mirror the `lock_timeout` / `CONCURRENTLY`-if-large convention from migration 030. Effort: Small. Risk: low.
2. Defer until the catalog grows (accept the seq-scan for MVP), tracked here. Effort: none now.

## Recommended Action
**RESOLVED — Solution 1.** Added migration `1716000000031-AddFractionContractsDeployedIndex` creating the partial covering index `IDX_fc_deployed ON fraction_contracts (artwork_id, token_address) WHERE status='deployed' AND deleted_at IS NULL`, matching the `findAllDeployed()` predicate exactly and keying on the two columns `buildHoldings` consumes. Follows the `…030` `lock_timeout` convention.

## Technical Details
- New migration on `fraction_contracts`. Re-ran `yarn db:test:setup`; index verified present in `tove_test`.

## Acceptance Criteria
- [x] Partial index matching the query predicate exists.
- [x] Migration loads cleanly; index confirmed via `pg_indexes`.

## Work Log
- 2026-07-18: created from PR #35 review (performance-oracle P1.1).
- 2026-07-18: RESOLVED — added migration …031 (`IDX_fc_deployed`); test DB reloaded + index verified.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
