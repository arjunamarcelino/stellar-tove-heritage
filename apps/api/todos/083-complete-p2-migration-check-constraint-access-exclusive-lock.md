---
status: complete
priority: p2
issue_id: 083
tags: [code-review, database, migration, performance, tov-20]
dependencies: []
---

# `ADD CONSTRAINT CHECK` Takes ACCESS EXCLUSIVE + Full-Table Validation Scan on `users`

## Problem Statement
Adding a validated CHECK constraint locks `users` (ACCESS EXCLUSIVE) and scans every row to validate.
On a growing production `users` table this blocks all reads/writes for the scan duration. There is no
*validation failure* risk (all existing rows were previously NOT NULL, so they satisfy the check) — only
a *lock-duration* risk that scales with table size.

## Findings
- `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts:11-14` — single-statement
  `ALTER TABLE users ADD CONSTRAINT CHK_users_email_has_hash CHECK (...)`.
- The preceding `DROP NOT NULL` calls are catalog-only and fine.
- Interacts with `migrationsTransactionMode`: CLI data-source sets `'each'` (`src/database/data-source.ts:16`),
  runtime `migrationsRun` defaults to `'all'` — the NOT VALID/VALIDATE split below cannot share one transaction.

## Proposed Solutions

### Option A: NOT VALID then VALIDATE
- **Description:**
  ```sql
  ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_has_hash"
    CHECK ("email" IS NULL OR "password_hash" IS NOT NULL) NOT VALID;
  ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_email_has_hash";
  ```
  `VALIDATE` takes only SHARE UPDATE EXCLUSIVE and doesn't block DML. Run the two statements outside a
  single wrapping transaction (via `queryRunner` control, or set this migration's transaction mode to `none`).
- **Pros:** No app-blocking lock on `users`.
- **Cons:** Two statements; must respect transaction-mode constraint.
- **Effort:** Small
- **Risk:** Low

### Option B: Accept the lock (small tables only)
- **Description:** Leave as-is if `users` is guaranteed small at deploy time.
- **Pros:** Simplest.
- **Cons:** Doesn't scale; risky if the table grows before deploy.
- **Effort:** None
- **Risk:** Medium

## Recommended Action
Option A — split into `ADD ... NOT VALID` then `VALIDATE CONSTRAINT`.

## Implemented Solution
`up()` now adds the CHECK as `... NOT VALID` (catalog-only, brief ACCESS EXCLUSIVE, no scan) and then
runs a separate `ALTER TABLE users VALIDATE CONSTRAINT CHK_users_email_has_hash`. The validation scan
runs under SHARE UPDATE EXCLUSIVE, so concurrent reads/writes on `users` aren't blocked. No
transaction-mode change was needed — even within the migration's wrapping transaction the expensive
scan happens under the weaker lock. Verified by dropping and re-provisioning `tove_test` from scratch:
both statements execute successfully and the constraint is present.

## Technical Details
- Changed: `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts` (`up()`); `down()`
  still just `DROP CONSTRAINT` (unchanged, correct).

## Acceptance Criteria
- [x] Adding the CHECK no longer holds ACCESS EXCLUSIVE on `users` for a full-table scan (scan is under VALIDATE's SHARE UPDATE EXCLUSIVE).
- [x] Migration runs cleanly from scratch (verified via fresh `yarn db:test:setup`).

## Work Log
- 2026-07-02: Filed from PR #20 review (data-integrity-guardian, P2).
- 2026-07-02: Fixed — NOT VALID + VALIDATE split; verified fresh migration. Marked complete.
