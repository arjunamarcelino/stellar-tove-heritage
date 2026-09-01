---
status: complete
priority: p2
issue_id: 031
tags: [code-review, database, migration]
dependencies: []
---

# Missing citext Extension Declaration in Admins Migration

## Problem Statement
The admins table migration uses `citext` column type for email but doesn't ensure the `citext` extension exists. If this migration runs on a fresh database before the users migration (which presumably creates the extension), it will fail.

## Findings
- `src/database/migrations/1716000000002-CreateAdminsTable.ts` uses `citext` for email column
- No `CREATE EXTENSION IF NOT EXISTS "citext"` in this migration
- The users table migration presumably creates the extension, but migration ordering shouldn't be relied upon for extension availability
- A fresh database with only the admins migration would fail

## Proposed Solutions

### Option A: Add extension creation to admins migration
- **Description:** Add `CREATE EXTENSION IF NOT EXISTS "citext"` at the top of the admins migration's `up()` method. The `IF NOT EXISTS` makes it idempotent.
- **Pros:** Self-contained migration; works regardless of execution order; idempotent
- **Cons:** Duplicate extension creation across migrations (harmless with IF NOT EXISTS)
- **Effort:** Small
- **Risk:** Low

### Option B: Create a dedicated extension migration with lowest timestamp
- **Description:** Create a migration like `1000000000000-CreateExtensions.ts` that creates all needed extensions. Give it the lowest timestamp so it always runs first.
- **Pros:** Single source of truth for extensions; clean separation
- **Cons:** Another migration file; needs to be the very first migration
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented. Added `CREATE EXTENSION IF NOT EXISTS "citext"` at the top of the admins migration `up()` method. The `IF NOT EXISTS` clause makes it idempotent, so it's harmless if the extension already exists from the users migration.

## Technical Details
- **Affected files:** `src/database/migrations/1716000000002-CreateAdminsTable.ts`
- **Components:** Database migrations

## Acceptance Criteria
- [x] Admins migration succeeds on a fresh database without depending on other migrations
- [x] citext extension is available before email column creation

## Work Log
- 2026-05-21: Created from PR #2 code review (Data migration expert, Data integrity guardian)
- 2026-05-21: Resolved. Added idempotent `CREATE EXTENSION IF NOT EXISTS "citext"` at the top of the `up()` method.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
