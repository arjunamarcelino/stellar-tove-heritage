---
status: complete
priority: p2
issue_id: "045"
tags: [code-review, performance, database, migration]
dependencies: []
---

# Missing Standalone IDX_missions_stage_id Index

## Problem Statement

The missions table has a FK constraint on `stage_id` but no standalone index. Queries filtering missions by stage (used in `findByStageId`, `countActiveMissionsByStageIds`, backoffice listing) will require sequential scans on larger datasets.

## Findings

- Migration `1748796719498-CreateMissions.ts` — no `CREATE INDEX` on `stage_id` alone
- Composite unique index `(stage_id, order)` exists but PostgreSQL can only use it efficiently when both columns are in the query
- `findByStageId()` queries by `stage_id` alone — needs standalone index
- Identified by: migration-expert (ISSUE 1), performance-oracle (OPT-2), data-integrity-guardian (MEDIUM)

## Proposed Solutions

### Option 1: Add migration with standalone index (Recommended)

**Approach:** New migration: `CREATE INDEX "IDX_missions_stage_id" ON missions (stage_id) WHERE deleted_at IS NULL`

**Effort:** Small | **Risk:** Low

## Technical Details

**Affected files:**
- `src/database/migrations/` — new migration

**Database changes:**
- New partial index on missions.stage_id

## Acceptance Criteria

- [ ] Index exists for `stage_id` with `WHERE deleted_at IS NULL`
- [ ] Migration has both `up()` and `down()`

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
