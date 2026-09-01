---
status: complete
priority: p2
issue_id: 135
tags: [code-review, typescript, data-integrity, export, TOV-40]
dependencies: []
---

# Status string-unions are hand-mirrored to DB CHECKs with no compile-time link; status() mapping not exhaustive

## Problem Statement
Four status string-unions (`WalletStatus`, `WalletExportStatus`, `WalletExportItemStatus`, `ExportTokenKind`) each have a hand-mirrored SQL `CHECK (... IN (...))`, plus a fifth copy (`ExportReadState`). They agree today, but adding a member (e.g. `'cancelled'`) compiles clean and passes all TS, then fails at runtime on INSERT against the CHECK. Worse, the `status()` read mapping is a manual ternary chain with no exhaustiveness guard, so a new `WalletExportStatus` member silently falls through to `'pending'`.

## Findings
- `src/modules/wallets/export/export-status.types.ts:2-11` — four unions.
- `src/database/migrations/1716000000016-AddWalletExportState.ts:50-91` — hand-mirrored CHECK lists.
- `src/modules/wallets/export/dto/export-status-response.dto.ts:5` — fifth `ExportReadState` copy.
- `wallet-export.service.ts:296-303` — ternary mapping, no `assertNever` default → silent `'pending'` fallthrough.

## Proposed Solutions

### Option A: Shared `as const` status arrays + assertNever exhaustiveness
- **Description:** Export `const EXPORT_STATUSES = [...] as const` (etc.), reference them when authoring the migration CHECK strings, and add an `assertNever(exp.status)` default to the `status()` mapping so a new member is a compile error, not a silent `'pending'`. Add an `assertNever` helper to `common/` (none exists yet).
- **Pros:** Drift becomes a compile error; single source for the allowed values.
- **Cons:** Migrations are static SQL strings — the link is authoring-time, not enforced at migration-run; still a meaningful guard.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — const-derived unions + assertNever exhaustiveness (confirmed).

## Implemented Solution
`export-status.types.ts` now exports `as const` arrays (`WALLET_EXPORT_STATUSES`,
`WALLET_EXPORT_ITEM_STATUSES`, `EXPORT_TOKEN_KINDS`) as the single source, with the TS unions derived via
`(typeof …)[number]`; the migration CHECK lists must mirror these (documented in the file). Added
`src/common/utils/assert-never.ts` and refactored the `status()` read mapping into an exhaustive
`switch` with an `assertNever(status)` default — a new `WalletExportStatus` without a case is now a
compile error, not a silent `'pending'` fallthrough. The DTO Swagger `enum` arrays now spread the const
arrays (`[...WALLET_EXPORT_ITEM_STATUSES]`, etc.) instead of re-listing the strings, removing the extra
copies. Also dropped the unused duplicate `WalletStatus` from this file (the entity owns its own).

## Technical Details
Affected: `src/common/utils/assert-never.ts` (new), `export-status.types.ts` (const-derived),
`wallet-export.service.ts` (`mapExportStateForRead` + assertNever), `dto/{submit-export-response,
export-status-response,export-wallet-response}.dto.ts` (enum arrays reference the consts).

## Acceptance Criteria
- [x] Adding a status union member without updating the mapping is a compile error.
- [x] The allowed values have a single canonical source (referenced by the migration author).

## Work Log
- 2026-07-14: Filed from PR #25 review (typescript reviewer).
- 2026-07-15: const-derived unions + assertNever + DTO enums reference the consts. build + lint + 305 unit + 9 e2e green. Marked complete.
