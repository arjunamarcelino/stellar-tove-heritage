---
status: complete
priority: p2
issue_id: "046"
tags: [code-review, performance, database, migration]
dependencies: []
---

# Missing Non-Partial IDX_submissions_user_id Index

## Problem Statement

The submissions table lacks a standalone index on `user_id`. User-facing queries (`findAllByUser`, `findByUserAndMission`, `findAccepted`, `findPending`) all filter by `user_id` and will degrade with table growth.

## Findings

- Migration has partial unique indexes for `(user_id, mission_id)` scoped by status, but no general `user_id` index
- `findAllByUser()` queries `WHERE userId = ?` — benefits from standalone index
- Identified by: migration-expert (ISSUE 2)

## Proposed Solutions

### Option 1: Add partial index on user_id (Recommended)

**Approach:** `CREATE INDEX "IDX_submissions_user_id" ON submissions (user_id) WHERE deleted_at IS NULL`

**Effort:** Small | **Risk:** Low

## Technical Details

**Affected files:**
- `src/database/migrations/` — new migration (can combine with #045)

## Acceptance Criteria

- [ ] Index exists for `user_id` with `WHERE deleted_at IS NULL`
- [ ] Migration has both `up()` and `down()`

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
