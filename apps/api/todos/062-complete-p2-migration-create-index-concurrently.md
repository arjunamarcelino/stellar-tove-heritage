---
status: complete
priority: p2
issue_id: "062"
tags: [code-review, database, migration]
dependencies: []
---

# Migration should use CREATE INDEX CONCURRENTLY

## Problem Statement

Migration `1716000000009-AddSubmissionsMissionUserStatusIndex.ts` uses `CREATE INDEX` which acquires a `SHARE` lock on the `submissions` table, blocking all writes for the duration of the index build. On a table with existing data in production, this can cause downtime.

## Findings

- **Source:** Data Migration Expert, Data Integrity Guardian
- **File:** `src/database/migrations/1716000000009-AddSubmissionsMissionUserStatusIndex.ts:6`
- **Risk:** Table lock blocks writes during index build in production

## Proposed Solutions

### Option A: Use CREATE INDEX CONCURRENTLY (Recommended)
```sql
CREATE INDEX CONCURRENTLY "IDX_submissions_mission_user_status"
  ON "submissions" ("mission_id", "user_id", "status")
  WHERE "deleted_at" IS NULL
```
- **Pros:** No write blocking, production-safe
- **Cons:** `CONCURRENTLY` cannot run inside a transaction — TypeORM migration transaction wrapping must be handled
- **Effort:** Small
- **Risk:** Low — need to ensure migration doesn't run in a transaction

### Option B: Keep as-is for now
- **Pros:** Simpler, table is small at this stage
- **Cons:** Becomes a problem as data grows
- **Effort:** None
- **Risk:** Medium — will cause downtime if run on a large table later

## Recommended Action

Option A if targeting production with existing data. Option B acceptable if this is pre-launch and the table is empty.

## Technical Details

- **Affected files:** `src/database/migrations/1716000000009-AddSubmissionsMissionUserStatusIndex.ts`

## Acceptance Criteria

- [x] Migration uses `CREATE INDEX CONCURRENTLY`
- [x] Migration handles transaction wrapping correctly (`transaction = false as const`)
- [ ] Both `up` and `down` paths tested (requires test DB)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-03 | Created from PR #8 review | CREATE INDEX CONCURRENTLY cannot run inside a transaction |
| 2026-06-03 | Fixed: added CONCURRENTLY + `transaction = false as const` | TypeORM MigrationInterface supports `transaction` property to disable per-migration transaction wrapping |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/8
- PostgreSQL docs: CREATE INDEX CONCURRENTLY
