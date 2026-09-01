---
status: complete
priority: p2
issue_id: 318
tags: [code-review, database, migration, tov-160]
dependencies: []
---
# Migration 039's `CREATE INDEX CONCURRENTLY` inherits a leaked `lock_timeout = 3s` from prior money migrations

## Problem Statement
Migration `1716000000039-AddOfferingBidsClearingIndex.ts` runs `CREATE INDEX CONCURRENTLY`, but every prior money migration (034/036/037/038) runs `SET lock_timeout = '3s'` — a plain **session** `SET` (not `SET LOCAL`), which persists across `COMMIT` on TypeORM's **shared** queryRunner connection (`MigrationExecutor` reuses one connection for the whole `migration:run`, with `migrationsTransactionMode: 'each'`). So 039's `CONCURRENTLY` build inherits `lock_timeout = 3s` despite its docstring claiming "No lock_timeout … bid writes keep flowing." `CONCURRENTLY`'s `ShareUpdateExclusive` acquisition and virtual-xid waits are subject to `lock_timeout`; on a live `offering_bids` table with any in-flight long transaction the build aborts after 3s — exactly the concurrent-write scenario the split exists for. It is re-runnable (leading `DROP INDEX ... IF EXISTS`) so not data-unsafe, but it repeatedly blocks deploys and contradicts its own documented behavior.

## Findings
- `src/database/migrations/1716000000039-AddOfferingBidsClearingIndex.ts` — runs `CREATE INDEX CONCURRENTLY` with a docstring asserting no `lock_timeout` is set / bid writes keep flowing; but does not reset the inherited session `lock_timeout`.
- Migrations `034`/`036`/`037`/`038` — each runs `SET lock_timeout = '3s'` (session-level `SET`, not `SET LOCAL`), so the value survives their `COMMIT`.
- TypeORM `MigrationExecutor` reuses a **single** connection across the whole `migration:run` with `migrationsTransactionMode: 'each'`, so the leaked session GUC reaches 039.
- **Effect:** the `CONCURRENTLY` build's `ShareUpdateExclusive` + virtual-xid waits are bound by `lock_timeout = 3s` and abort under exactly the live-write conditions the concurrent build is meant to survive.

## Proposed Solutions
### Option A — Reset `lock_timeout` at the top of 039
- Description: Add `await queryRunner.query('RESET lock_timeout')` (or `SET lock_timeout = 0`) as the **first** statement of 039's `up()`, before the `CREATE INDEX CONCURRENTLY`.
- Pros: Minimal, targeted; restores the documented behavior; the `CONCURRENTLY` build waits as long as needed rather than aborting at 3s.
- Cons: None material; leaves the underlying leak pattern (session `SET`) in prior migrations.
- Effort: Small
- Risk: Low

### Option B — Convert prior migrations to `SET LOCAL lock_timeout`
- Description: Change 034/036/037/038 to `SET LOCAL lock_timeout = '3s'` so the value is transaction-scoped and never leaks across `COMMIT`.
- Pros: Fixes the root cause; no migration can leak a session GUC to a later one.
- Cons: Touches already-deployed migrations (edit-in-place risk if applied anywhere); does not by itself guarantee 039 starts from a clean GUC if any future migration reintroduces a session `SET`.
- Effort: Small
- Risk: Medium

## Recommended Action
Option A — add `await queryRunner.query('RESET lock_timeout')` (or `SET lock_timeout = 0`) as the first statement of 039's `up()`. It is the smallest, most robust fix and makes 039 self-defending regardless of what prior migrations leak.

## Technical Details
The shared-connection GUC leak is a consequence of TypeORM reusing one connection for the entire `migration:run` under `migrationsTransactionMode: 'each'`. A plain `SET` mutates session state that outlives the per-migration transaction. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block and takes `ShareUpdateExclusiveLock` plus waits on concurrent transactions' virtual xids; both acquisition points honor `lock_timeout`. Setting `lock_timeout = 0` (or `RESET`) restores the intended "wait indefinitely, don't block writers" semantics.

## Acceptance Criteria
- Running `migration:run` end-to-end (034 → 039) leaves 039's `CREATE INDEX CONCURRENTLY` executing with `lock_timeout` of `0` (verified, e.g., via a `SHOW lock_timeout` probe or session log).
- 039's documented behavior ("no lock_timeout; bid writes keep flowing") matches its runtime behavior.
- 039 remains re-runnable (leading `DROP INDEX ... IF EXISTS`).

## Work Log
- 2026-08-20: created from PR #43 [data-migration-expert] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Added `await queryRunner.query('RESET lock_timeout')` as the FIRST statement of migration
`1716000000039` `up()`, before the `DROP INDEX CONCURRENTLY` / `CREATE INDEX CONCURRENTLY`. This clears
the session-scoped `lock_timeout='3s'` that prior money migrations (034/036/037/038) set with a plain
`SET` (not `SET LOCAL`), which persists across COMMIT on TypeORM's shared `migration:run` queryRunner
connection. The CONCURRENTLY build now runs with the default (no) lock timeout, so it can wait out a
concurrent long transaction on `offering_bids` instead of aborting after 3s — restoring the online-index
guarantee the split was designed for. `down()` is additive-only (unconditional CONCURRENTLY drop) and
needs no change. Verified the migration still applies cleanly (`yarn db:test:setup`).
