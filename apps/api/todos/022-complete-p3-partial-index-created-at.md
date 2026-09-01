---
status: complete
priority: p3
issue_id: 022
tags: [code-review, database, performance]
dependencies: []
---

# IDX_users_created_at Should Be Partial Index

## Problem Statement
`IDX_users_created_at` covers all rows including soft-deleted ones. Since queries on `created_at` almost always exclude soft-deleted rows, the full index wastes space and I/O. The email unique index already uses a partial index pattern.

## Findings
- `src/database/migrations/1716000000000-CreateUsersTable.ts`: full index on `created_at`
- Email unique index in the same migration uses `WHERE "deleted_at" IS NULL`
- Inconsistent indexing strategy

## Proposed Solutions

### Option A: Create Migration to Replace with Partial Index
- **Description:** New migration that drops and recreates `IDX_users_created_at` with `WHERE "deleted_at" IS NULL`.
- **Pros:** Smaller index; faster maintenance; consistent with existing strategy
- **Cons:** Requires a new migration
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Create Migration to Replace with Partial Index

## Implemented Solution

Created migration `1716000000001-MakeCreatedAtIndexPartial.ts` that drops the full `IDX_users_created_at` and recreates it as a partial index with `WHERE "deleted_at" IS NULL`. The down() method reverses this by recreating the full index.

### Commit
`842d433` — `fix(db): make IDX_users_created_at a partial index excluding soft-deletes`

## Technical Details
- **Affected Files:** src/database/migrations/1716000000001-MakeCreatedAtIndexPartial.ts (new)
- **Components:** Users table migration, database indexes

## Acceptance Criteria
- [x] `IDX_users_created_at` is a partial index with `WHERE "deleted_at" IS NULL`
- [x] A new migration handles the index replacement (not editing the original migration)
- [x] The partial index pattern is consistent with the email unique index
- [ ] Queries filtering by `created_at` with soft-delete exclusion use the index (verified via EXPLAIN)

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (new migration for partial index). Commit `842d433` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
