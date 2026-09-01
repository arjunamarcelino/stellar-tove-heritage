---
status: complete
priority: p3
issue_id: 139
tags: [code-review, data-integrity, database, export, TOV-40]
dependencies: [127]
---

# wallet_exports/items DB hardening: soft-delete partial indexes, item confirmed⟺tx_hash CHECK, FK cascade

## Problem Statement
Three latent DB-integrity gaps on the export tables (latent because soft-delete is never actually used on them today):
1. Both tables carry `deleted_at` (via `BaseEntity`), but the FK indexes on `wallet_exports` and ALL of `wallet_export_items`' indexes lack the mandated `WHERE deleted_at IS NULL` predicate (project rule in `src/database/CLAUDE.md`). `UQ_wallet_export_items_tx_hash` is `WHERE tx_hash IS NOT NULL` only, not `AND deleted_at IS NULL`. The repo reads rely on TypeORM's implicit `deleted_at IS NULL` filter, which these indexes don't cover.
2. `wallet_export_items` has no status⟺timestamp CHECK — an item could be `confirmed` with `tx_hash IS NULL` (the service always sets them together, but the DB doesn't enforce it, unlike the parent + wallet CHECKs).
3. `FK_wallet_export_items_export_id` is `ON DELETE NO ACTION`; for an aggregate child with no independent identity, `ON DELETE CASCADE` is conventional/safer.

## Findings
- `src/database/migrations/1716000000016-AddWalletExportState.ts:68-104` — item indexes + tx_hash unique lack `deleted_at` predicate.
- Same file — no `(status='confirmed') = (tx_hash IS NOT NULL)` CHECK on items.
- Same file:86-87 — item FK `ON DELETE NO ACTION`.
- Verified: the export module never calls `softRemove` today (latent, not actively broken).

## Proposed Solutions

### Option A: Add the predicates/CHECK/cascade (new migration) OR document deleted_at is inert
- **Description:** Either add `WHERE deleted_at IS NULL` to the item/export indexes (+ `AND deleted_at IS NULL` to the tx_hash unique), add `CHECK (("status"='confirmed') = ("tx_hash" IS NOT NULL))` on items, and change the item FK to `ON DELETE CASCADE`; OR make a deliberate decision that these aggregate rows are never soft-deleted and document why `BaseEntity`'s `deleted_at` is inert here.
- **Pros:** Consistent with the project's soft-delete indexing rule + the parent/wallet CHECK design.
- **Cons:** Requires a follow-up migration (+ re-run `yarn db:test:setup`).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Full — soft-delete partial indexes + item FK ON DELETE CASCADE (confirmed). NOT the confirmed↔tx_hash
CHECK: it conflicts with the todo-127 reconciliation, which marks items confirmed without a tx hash.

## Implemented Solution
Migration `1716000000018-HardenWalletExportIndexes.ts`: re-scoped the five export/item indexes to live
rows (`WHERE deleted_at IS NULL`; the tx_hash unique also gains `AND deleted_at IS NULL`) per the project
soft-delete rule, and changed `FK_wallet_export_items_export_id` to `ON DELETE CASCADE` (an export item is
an aggregate child with no independent identity). Deliberately omitted the `(status='confirmed') =
(tx_hash IS NOT NULL)` CHECK — the crash-recovery reconciliation (127) legitimately confirms items with a
null tx hash, so that biconditional would be wrong (documented in the migration).

## Technical Details
Affected: `src/database/migrations/1716000000018-HardenWalletExportIndexes.ts` (new); integration test
asserts the parent-delete cascade. Re-ran `yarn db:test:setup`.

## Acceptance Criteria
- [x] Soft-delete partial-index predicates added to the export/item indexes + tx_hash unique.
- [x] Item FK is `ON DELETE CASCADE`; cascade covered by an integration test.

## Work Log
- 2026-07-14: Filed from PR #25 review (data-integrity reviewer).
- 2026-07-15: Migration 18 (partial indexes + FK cascade); dropped the tx_hash CHECK (conflicts with 127). build + lint + 8 integration + 10 e2e green. Marked complete.
