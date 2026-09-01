---
status: complete
priority: p3
issue_id: 140
tags: [code-review, simplicity, dead-code, export, TOV-40]
dependencies: [127]
---

# Remove ship-ahead-of-writer states/columns (challenge column, EXPORT_FAILED, parent 'failed', item 'submitted')

## Problem Statement
Several declared states/columns have no writer/reader in the current code path, adding reasoning surface on a security-sensitive flow:
1. `wallet_export_items.challenge` is written on every build but never read back (responses use the fresh `built.challenge`; submit verifies against the stored `unsigned_tx_xdr`). Write-only column.
2. `AUDIT_KIND.EXPORT_FAILED` is declared but never emitted.
3. Parent `wallet_exports.status = 'failed'` is unreachable (service only writes pending/submitting/completed).
4. Item `WalletExportItemStatus` includes `'submitted'`, never assigned (items go pending→confirmed/failed).

## Findings
- `src/modules/wallets/export/entities/wallet-export-item.entity.ts:39-40` + repo `:59` + migration `:77` — `challenge` write-only.
- `src/modules/wallets/export/audit-log.types.ts:9` — `EXPORT_FAILED` unused.
- `export-status.types.ts:5` + migration CHECK + `status()` mapping — parent `'failed'` unreachable.
- `export-status.types.ts:8` + item CHECK `:91` + two DTO enums — item `'submitted'` never written.

## Proposed Solutions

### Option A: Remove the dead artifacts (or wire them if intended)
- **Description:** Drop the `challenge` column + field + `ItemBuildInput.challenge`; remove `EXPORT_FAILED`; remove parent `'failed'` from the union/CHECK/mapping; remove item `'submitted'` from the union/CHECK/DTO enums. EXCEPTION: if [[127]] (crash-window reconciliation) will introduce a `'submitted'` writer, keep `'submitted'` and note it reserved.
- **Pros:** Type reflects reachable states; fewer columns/enum members to reason about on a money flow.
- **Cons:** A migration change for the column/CHECK removals; coordinate with [[127]].
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Remove the write-only `challenge` column only (confirmed). Keep the rest — the picture changed:

## Implemented Solution
Removed the write-only `wallet_export_items.challenge` column (migration
`1716000000019-DropExportItemChallenge.ts` + entity field + `ItemBuildInput.challenge` + the repo write +
the service's `upsertItemBuild` arg). It was persisted but never read: responses always emit the FRESH
build challenge, and submit verifies against the stored `unsigned_tx_xdr`.

Deliberately KEPT (no longer dead / reserved by design):
- **Item `'submitted'` status** — now genuinely written (the [[125]] CAS claim + the [[127]] crash
  reconciliation both use it). No longer dead.
- **`AUDIT_KIND.EXPORT_FAILED`** — now emitted by the per-item failure audit in [[142]].
- **Parent `wallet_exports.status='failed'`** — kept as a documented reserved terminal state (no writer
  today; removing it would need a migration + type churn for no functional gain).

## Technical Details
Affected: `1716000000019-DropExportItemChallenge.ts` (new), `wallet-export-item.entity.ts`,
`wallet-export-repository.interface.ts` (`ItemBuildInput`), `wallet-export.repository.ts` (`upsertItemBuild`),
`wallet-export.service.ts`. Re-ran `yarn db:test:setup`.

## Acceptance Criteria
- [x] Every declared status/column has a writer+reader or is documented as reserved.

## Work Log
- 2026-07-14: Filed from PR #25 review (simplicity + pattern + typescript reviewers).
- 2026-07-15: Dropped the write-only `challenge` column; documented that 'submitted'/EXPORT_FAILED are now used and parent 'failed' is reserved. build + lint + 10 e2e green. Marked complete.
