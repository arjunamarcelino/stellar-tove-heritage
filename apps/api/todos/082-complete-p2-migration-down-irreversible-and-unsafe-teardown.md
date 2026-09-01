---
status: complete
priority: p2
issue_id: 082
tags: [code-review, database, migration, tov-20]
dependencies: []
---

# Migration `down()` Is Irreversible Once a BYOW User Exists (and Tears Down Schema in Unsafe Order)

## Problem Statement
`1716000000011-AddWalletsAndAuthChallenges.ts` `down()` runs `ALTER COLUMN "password_hash" SET NOT NULL`
and `ALTER COLUMN "email" SET NOT NULL`. Every BYOW user is inserted with `email = NULL` and
`password_hash = NULL` (`wallets.service.ts:35-38`). The moment one such row exists, a rollback throws
`column "..." contains null values` and aborts — **after** `wallets` and `auth_challenges` have already
been dropped, losing wallet data and leaving a half-torn schema. So `down()` is clean only on a
pre-BYOW dataset.

## Findings
- `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts:68-78` — down() drops tables first,
  then `SET NOT NULL` (which fails if any wallet-only user exists).
- Wallet-only users are created with null email + null password_hash: `src/modules/wallets/wallets.service.ts:35-38`.

## Proposed Solutions

### Option A: Guard the SET NOT NULL + reorder teardown
- **Description:** In `down()`, first delete wallet-only users, then re-add NOT NULL, and drop the
  challenge/wallet tables **last** so a failing ALTER doesn't destroy data:
  ```sql
  DELETE FROM users u
  WHERE u.password_hash IS NULL
    AND EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id);
  -- then SET NOT NULL, then DROP wallets / auth_challenges
  ```
- **Pros:** Rollback succeeds regardless of data; no half-torn schema.
- **Cons:** `down()` performs a destructive DELETE — must be explicit/documented.
- **Effort:** Small
- **Risk:** Low-Medium (down() now deletes data by design)

### Option B: Make down() refuse when BYOW users exist
- **Description:** Raise a clear error early in `down()` if wallet-only users exist, instructing the
  operator to clean up first.
- **Pros:** No surprise data loss.
- **Cons:** Rollback isn't automatic.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — reorder teardown + delete wallet-only users before restoring NOT NULL.

## Implemented Solution
`down()` now (1) drops `auth_challenges` and `wallets` first (releasing the FK from
`wallets.user_id`), (2) runs `DELETE FROM users WHERE password_hash IS NULL` to remove the
wallet-only accounts (the CHECK guarantees this predicate matches only credential-less BYOW users),
then (3) drops the CHECK and restores `SET NOT NULL` on `password_hash`/`email` — which now succeeds
because no null-credential rows remain. Added a comment flagging the revert as intentionally
destructive (drops wallet data + wallet-only accounts), which is correct for a full rollback.

## Technical Details
- Changed: `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts` (`down()`).

## Acceptance Criteria
- [x] `down()` succeeds when BYOW users exist (wallet-only users are deleted before `SET NOT NULL`).
- [x] Tables are dropped in FK-safe order and NOT NULL is restored only after null rows are removed, so no partial teardown.

## Work Log
- 2026-07-02: Filed from PR #20 review (data-integrity-guardian, P2).
- 2026-07-02: Fixed — reordered destructive teardown + delete wallet-only users. Marked complete.
