---
status: complete
priority: p3
issue_id: 155
tags: [code-review, data-integrity, migrations, TOV-24]
dependencies: []
---

# Migration `down()` drops lack `IF EXISTS`; `020` down() becomes destructive after FR-01.04

## Problem Statement
Both new migrations' `down()` use bare `DROP INDEX "…"` / `DROP CONSTRAINT "…"` without `IF EXISTS`, so a
half-applied `up()` (e.g. an operator manually intervened) makes `down()` throw. Separately, `020` down()
drops `is_primary`, which discards the primary designation — harmless today (it's derived from wallet order,
re-`up()` re-derives it) but genuinely destructive once **FR-01.04** makes primary user-editable.

## Findings
- `src/database/migrations/1716000000020-AddWalletsIsPrimary.ts` — `down()`: `DROP INDEX
  "UQ_wallets_primary_active"` + `DROP COLUMN "is_primary"` (no `IF EXISTS`; destructive-after-FR-01.04).
- `src/database/migrations/1716000000021-AddAuthChallengeUserId.ts` — `down()`: `DROP INDEX`/`DROP CONSTRAINT`
  (no `IF EXISTS`).
- data-integrity reviewer (P3).

## Proposed Solutions

### Option A: Add `IF EXISTS` to all `down()` drops + document `020` as destructive-after-FR-01.04 (recommended)
- **Pros:** Safer re-runs; future maintainers warned before FR-01.04 makes `down()` lossy.
- **Cons:** None material.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A.

## Implemented Solution
- `1716000000020-AddWalletsIsPrimary.ts` `down()`: `DROP INDEX IF EXISTS` + `DROP COLUMN IF EXISTS`, plus a
  note that dropping `is_primary` becomes destructive once FR-01.04 makes the primary user-editable.
- `1716000000021-AddAuthChallengeUserId.ts` `down()`: `DROP INDEX IF EXISTS` + `DROP CONSTRAINT IF EXISTS` +
  `DROP COLUMN IF EXISTS`.

## Technical Details
Affected: `src/database/migrations/1716000000020-*.ts`, `1716000000021-*.ts` (`down()` only). No `up()` change.

## Acceptance Criteria
- [x] `down()` drops use `IF EXISTS`.
- [x] `020` down() carries a doc note that it's destructive once primary is user-editable (FR-01.04).

## Work Log
- 2026-07-15: Filed from PR #26 data-integrity review (P3).
- 2026-07-15: Added `IF EXISTS` to both `down()` methods + the FR-01.04 destructive-note on 020.
