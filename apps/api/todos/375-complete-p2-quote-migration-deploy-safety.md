---
status: complete
priority: p2
issue_id: 375
tags: [code-review, migration, deployment, tov-175, pr-48]
dependencies: []
---
# Migration 044 deploy safety: unbounded ACCESS EXCLUSIVE build window + concurrent-replica boot crashloop (PR #48)

## Problem Statement
Two deploy-time risks in `1716000000044-CreateRfqQuotesTable.ts`, neither a data-corruption defect (the DDL is
correct, reversible, and atomic), but both worth pinning before deploy on the money table `rfqs`:
1. `ALTER TABLE rfqs ADD CONSTRAINT UQ_rfqs_id_fc UNIQUE (...)` builds a new b-tree over every live `rfqs` row
   while holding **ACCESS EXCLUSIVE** for the whole build. `SET LOCAL lock_timeout='3s'` bounds only the *wait*
   to acquire the lock, not how long the build *holds* it → all `rfqs` reads/writes stall for the build window.
   Fine while `rfqs` is small; the "sub-second" comment isn't code-enforced.
2. `migrationsRun` defaults to true, so every replica runs pending migrations in-process at boot, and TypeORM
   takes no advisory lock around the run. Two replicas booting concurrently against a DB where 044 is pending
   both attempt the `ADD CONSTRAINT` (no `IF NOT EXISTS`); the loser waits `lock_timeout` then fails with
   `42P07/42710` → boot crashloop until the row lands in `migrations`.

## Findings
Source: data-migration-expert (P2 ×2), corroborated by data-integrity-guardian (P3).
- `src/database/migrations/1716000000044-CreateRfqQuotesTable.ts:25-30` (SET LOCAL + ADD CONSTRAINT).
- `src/config/database.config.ts:10` (`migrationsRun` = `DB_MIGRATIONS_RUN !== 'false'`, default true).
- `src/database/data-source.ts:16` (`migrationsTransactionMode: 'each'` → CONCURRENTLY is illegal here, so the
  non-concurrent build is unavoidable inside this migration).

## Proposed Solutions
### Option A — Gate the migration as a single pre-deploy step + low-write window (Recommended, process-only)
- Set `DB_MIGRATIONS_RUN=false` on serving replicas and run `yarn typeorm migration:run` as one discrete
  pre-deploy job (also deterministically satisfies "migration precedes route boot"). Deploy during low `rfqs`
  write traffic. Verify `rfqs` row count first; optionally add `SET LOCAL statement_timeout` as a hard ceiling
  so a pathological build aborts-and-rolls-back rather than pinning the table.
- Pros: no code change; removes the crashloop race and bounds the lock window operationally.
- Cons: requires the deploy pipeline to support a gated migration step.
### Option B — Split the UNIQUE into a CONCURRENTLY migration (only if `rfqs` grows large)
- Separate `transaction:false` migration doing `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT ... USING
  INDEX`, ordered before the table create.
- Pros: no ACCESS EXCLUSIVE build stall. Cons: more migration machinery; unnecessary at current `rfqs` size.
- Effort: Medium · Risk: Low

## Resolution (2026-08-22, complete — Option A, process/runbook)
Authored the deploy runbook `docs/solutions/deployment-issues/2026-08-21-tov175-quote-submission-deploy-runbook.md`
capturing: `DB_MIGRATIONS_RUN=false` + a single gated `migration:run` step (kills the concurrent-replica boot
race), a low-write window + pre-deploy `rfqs` row-count check for the ACCESS EXCLUSIVE build, full post-deploy
verification SQL (constraints/indexes/trigger + FK-enforced negative test), the R1 wiring check, monitoring
thresholds, and the redeploy-not-revert rollback. No code change — the migration DDL is already correct
(confirmed by the migration + data-integrity reviewers); this is the operational envelope around it.

## Recommended Action
Option A (process). Capture it in the deploy runbook
(`docs/solutions/deployment-issues/2026-08-21-tov175-quote-submission-deploy-runbook.md`, to be authored):
`DB_MIGRATIONS_RUN=false` + gated `migration:run` + low-write window + pre-deploy row-count check.

## Technical Details
Pre-deploy row-count check:
```sql
SELECT reltuples::bigint AS est_rows FROM pg_class WHERE relname = 'rfqs';
```
Post-migration verification (constraint/FK/indexes/CHECKs/trigger present + FK enforced): see the review's
verification SQL block; include it in the runbook.

## Acceptance Criteria
- [x] Deploy runbook documents `DB_MIGRATIONS_RUN=false` + gated single migration step + low-write window.
- [x] `rfqs` row count checked before deploy (runbook step); ACCESS EXCLUSIVE window documented (Option A).
- [x] Post-migration verification SQL captured in the runbook.

## Work Log
- 2026-08-22: Filed from PR #48 review (data-migration-expert P2, data-integrity-guardian P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
