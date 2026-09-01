---
status: complete
priority: p3
issue_id: "064"
tags: [code-review, database, performance]
dependencies: ["062"]
---

# Consider dropping redundant IDX_submissions_mission_id index

## Problem Statement

The new composite index `IDX_submissions_mission_user_status` on `(mission_id, user_id, status) WHERE deleted_at IS NULL` fully subsumes the existing `IDX_submissions_mission_id` on `(mission_id) WHERE deleted_at IS NULL`. Maintaining both indexes adds write amplification without query benefit.

## Findings

- **Source:** Data Migration Expert
- **File:** `src/database/migrations/1716000000009-AddSubmissionsMissionUserStatusIndex.ts`
- **Impact:** Minor write performance overhead from maintaining a redundant index

## Proposed Solutions

### Option A: Drop the old index in the same migration (Recommended)
Add `DROP INDEX "IDX_submissions_mission_id"` to the up migration, and recreate it in the down migration.
- **Pros:** Clean, removes redundancy
- **Cons:** Need to verify no other queries rely specifically on the single-column index
- **Effort:** Small
- **Risk:** Low

### Option B: Keep both indexes
- **Pros:** No risk of breaking anything
- **Cons:** Redundant write overhead
- **Effort:** None
- **Risk:** None

## Recommended Action

Option A after verifying no queries specifically benefit from the single-column index.

## Technical Details

- **Affected files:** `src/database/migrations/1716000000009-AddSubmissionsMissionUserStatusIndex.ts`

## Acceptance Criteria

- [x] Verified no queries require single-column mission_id index
- [x] Old index dropped in migration (`DROP INDEX IF EXISTS`)
- [x] Down migration recreates old index

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-03 | Created from PR #8 review | Composite index with leading column subsumes single-column index on same column |
| 2026-06-03 | Fixed: added DROP INDEX IF EXISTS in up(), recreate in down() | All submission queries filter by mission_id as leading column — composite index covers them |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/8
