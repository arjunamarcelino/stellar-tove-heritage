---
status: complete
priority: p3
issue_id: 091
tags: [code-review, performance, database, tov-20]
dependencies: [085]
---

# Add Partial Index for `countOutstanding` (Currently Rides the Plain `public_key` Index)

## Problem Statement
`countOutstanding` filters `public_key = ? AND consumed_at IS NULL AND expires_at > now()` but is backed
only by `IDX_auth_challenges_public_key`, which returns **every** row for that pubkey (consumed + expired
included) and filters in the heap. Negligible with a healthy sweep + cap=5, but it degrades in exactly the
same failure mode as todo 085 (sweep lag → expired rows accumulate per pubkey).

## Findings
- `src/modules/auth/repositories/auth-challenge.repository.ts:37-44` — the count query.
- `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts:58-61` — only single-column
  `public_key` index exists.

## Proposed Solutions

### Option A: Partial composite index on live rows
- **Description:**
  ```sql
  CREATE INDEX "IDX_auth_challenges_pk_outstanding"
    ON "auth_challenges" ("public_key") WHERE "consumed_at" IS NULL;
  ```
  Keeps the count scanning only live rows regardless of sweep lag.
- **Pros:** Cheap; robust under backlog.
- **Cons:** One more index to maintain.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Fold the partial index into migration 011 (not yet deployed). Note: 086 replaced `countOutstanding`
with `pruneOutstanding`, which uses the same `public_key = ? AND consumed_at IS NULL` predicate — so the
index now serves `pruneOutstanding`.

## Implemented Solution
Replaced the plain `IDX_auth_challenges_public_key` with a partial index
`IDX_auth_challenges_public_key_outstanding ON auth_challenges (public_key) WHERE consumed_at IS NULL`
(the sole `public_key` query is `pruneOutstanding`, which filters to unconsumed rows). Updated the `down()`
DROP and the entity (removed the misleading plain `@Index()` on `publicKey`, added a comment that the
migration owns a partial index). Verified from a fresh `tove_test`: `pg_indexes` shows
`... (public_key) WHERE (consumed_at IS NULL)`.

## Technical Details
- Changed: `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts` (up + down),
  `src/modules/auth/entities/auth-challenge.entity.ts`.

## Acceptance Criteria
- [x] The `public_key` lookup (`pruneOutstanding`) is served by an index scanning only unconsumed rows (verified in `pg_indexes`).

## Work Log
- 2026-07-02: Filed from PR #20 review (performance-oracle + data-integrity, P3). Pairs with 085.
- 2026-07-02: Fixed — partial index folded into migration 011; re-targeted at pruneOutstanding (086). Marked complete.
