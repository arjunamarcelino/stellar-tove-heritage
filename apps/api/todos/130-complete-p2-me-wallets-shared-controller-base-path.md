---
status: complete
priority: p2
issue_id: 130
tags: [code-review, architecture, export, TOV-40]
dependencies: []
---

# Two modules both mount @Controller('me/wallets') — split ownership of one resource

## Problem Statement
`MeWalletsController` (`PublicMeWalletsModule`) and `WalletExportController` (`PublicWalletExportModule`) both declare `@Controller('me/wallets')` and are registered as two separate `RouterModule` children under `api/v1`. Nest permits this (routes differ by method+subpath), but it splits one REST resource (`api/v1/me/wallets`) across two modules with no single declaring owner, duplicates the base path in two decorators, and splits Swagger tags. The transfer precedent owns a distinct base path (`@Controller('wallet')`); there is no repo precedent for two modules sharing a controller base path. This will bite at the TOV-24 hand-off (TOV-24 owns the full `/me/wallets` surface).

## Findings
- `src/modules/wallets/me/me-wallets.controller.ts:14` — `@Controller('me/wallets')` GET ''.
- `src/modules/wallets/export/wallet-export.controller.ts:20` — `@Controller('me/wallets')` POST :id/export...
- `src/modules/public-api.module.ts:29-30` — both modules registered under the same prefix.
- CLAUDE.md: "RouterModule prefixes controllers by their declaring module."

## Proposed Solutions

### Option A: Merge into one me/wallets surface / module
- **Description:** Fold `MeWalletsController.list()` into a single `me/wallets` controller (or a single module that declares both the list route and the export routes); delete `PublicMeWalletsModule`; drop it from `PUBLIC_MODULES`.
- **Pros:** One declaring owner; single base path; unified Swagger tag; clean TOV-24 hand-off.
- **Cons:** Slightly larger controller mixing list + export concerns (acceptable — same resource).
- **Effort:** Small
- **Risk:** Low

### Option B: Keep separate but unify tags + cross-reference
- **Description:** Keep both modules (for TOV-24 hand-off), unify `@ApiTags`, add cross-referencing comments on both `@Controller('me/wallets')` lines.
- **Pros:** Minimal change.
- **Cons:** Leaves the split-ownership fragility.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — merge into one module/controller (confirmed).

## Implemented Solution
Folded the `GET /me/wallets` list handler into `WalletExportController` (now injecting `WalletsService`
alongside `WalletExportService`), moved `MeWalletDto` into `export/dto/`, and deleted the stopgap
`src/modules/wallets/me/` folder (controller + module + dto) and its entry in `PUBLIC_MODULES`. The
`me/wallets` resource now has a single declaring module (`PublicWalletExportModule`) and one Swagger tag
(`me-wallets`). The list route also received `@Throttle(30/min)` — which resolves [[137]]. The route path
is unchanged, so the FE contract + e2e are unaffected.

## Technical Details
Affected: `export/wallet-export.controller.ts` (+list, +WalletsService, tag `me-wallets`),
`export/dto/me-wallet.dto.ts` (moved), `public-api.module.ts` (dropped `PublicMeWalletsModule`), deleted
`src/modules/wallets/me/**`.

## Acceptance Criteria
- [x] The `me/wallets` base path has a single declaring module.
- [x] Swagger tags for the resource are consistent (`me-wallets`).

## Work Log
- 2026-07-14: Filed from PR #25 review (architecture reviewer).
- 2026-07-15: Merged into one controller/module; deleted the stopgap module; added list throttle (also closes 137). build + lint + 9 export e2e green. Marked complete.
