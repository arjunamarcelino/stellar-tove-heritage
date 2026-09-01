---
status: complete
priority: p2
issue_id: 149
tags: [code-review, architecture, wallets, TOV-24]
dependencies: []
---

# TOV-24 identity surface lives in the `export/` folder and its module owns two bounded concerns

## Problem Statement
The controller/module were renamed away from "export" (`MeWalletsController`, `PublicMeWalletsModule`) but
still physically live in `src/modules/wallets/export/`, alongside export-only assets (KYC allowlist, audit
log, export entities/repos). Two consequences:

1. **Folder name misdescribes contents.** The multi-wallet identity surface (list/add/remove/challenge —
   nothing to do with export) is defined under `export/`; a reader looking for it won't find it there.
2. **One module owns two concerns.** `PublicMeWalletsModule` provides both the identity stack
   (`MeWalletsService`, `IdempotencyStore`, `AuthModule`) and the entire TOV-40 export stack
   (`WalletExportService`, KYC/audit services, 3 repos, 4 entities, `RelayerModule`). Each concern pulls the
   other's providers into its DI scope; the blast radius of either change is the whole module.

The DI graph itself is **acyclic and correctly layered** (surface→auth, neutral wallets never imports auth,
orchestration/persistence split is clean) — this is organizational debt, not a correctness bug. The single
controller is justified (keeping `DELETE :id` and `GET :id/export` together for NestJS static-before-`:param`
route ordering), but a single *controller* doesn't require a single *module* to own both provider stacks.

## Findings
- `src/modules/wallets/export/{me-wallets.controller.ts, me-wallets.service.ts, public-me-wallets.module.ts}`
  — identity code under `export/`.
- `public-me-wallets.module.ts` providers mix identity + export stacks.
- `src/modules/CLAUDE.md` — stale: still describes `WalletExportController` / `PublicWalletExportModule` and
  the `GET /me/wallets` list as a "TOV-40 stopgap."
- Architecture reviewer (P1 organizational; pattern + architecture P3 on symmetry with `transfer/`).

## Proposed Solutions

### Option A: Promote a `wallets/me/` surface; keep export as a nested/sibling concern (recommended)
Move the identity files to `wallets/me/` (`public-me-wallets.module.ts`, `me-wallets.controller.ts`,
`me-wallets.service.ts`, `dto/*`). Group the export providers into their own module the me-module imports
(preserving the single controller). Update `modules/CLAUDE.md`.
- **Pros:** Folder matches responsibility; concerns independently evolvable; restores `transfer/`↔surface symmetry.
- **Cons:** File moves + import churn across tests and `public-api.module.ts`.
- **Effort:** Medium · **Risk:** Low–Medium (mechanical; covered by the existing test suite)

### Option B: Keep placement; only update docs + add a module JSDoc noting the deliberate coupling
- **Pros:** Zero code churn.
- **Cons:** Leaves the misdescriptive folder + wide module.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (full move to `wallets/me/`; export becomes provider-only).

## Implemented Solution
- **New `src/modules/wallets/me/`** — moved `me-wallets.controller.ts`, `me-wallets.service.ts`,
  `public-me-wallets.module.ts`, and `dto/{me-wallet,add-wallet,add-wallet-challenge}.dto.ts` here (git mv,
  history preserved). Most relative imports were unchanged (me/ and export/ are the same depth under
  `wallets/`); the controller's export-DTO + `wallet-export.service` imports repointed to `../export/...`.
- **`export/` is now provider-only** — new `WalletExportModule` provides + **exports** `WalletExportService`
  (plus the KYC/audit services + repos + export entities); no controller. `PublicMeWalletsModule` imports it
  and injects `WalletExportService` into the single `MeWalletsController` (which still owns both the identity
  verbs and the `:id/export...` routes, preserving NestJS static-before-`:param` ordering).
- Updated `public-api.module.ts` import path, the two unit-test import paths, and the stale
  `src/modules/CLAUDE.md` wallets description (documents the me/ identity surface + provider-only export).

No route/runtime changes (paths stay `api/v1/me/wallets...`). Full matrix green: **328 unit / 57
integration / 86 e2e**, build + lint clean — the export e2e passing confirms `WalletExportService` resolves
via the imported module.

## Technical Details
Affected: `src/modules/wallets/me/*` (moved), `src/modules/wallets/export/wallet-export.module.ts` (new,
provider-only), `public-api.module.ts`, `src/modules/CLAUDE.md`, two unit-test import paths.

## Acceptance Criteria
- [x] Identity surface lives in a directory whose name describes it (`wallets/me/`).
- [x] Export + identity provider stacks are separable (`WalletExportModule` provider-only, imported by the me-module).
- [x] `modules/CLAUDE.md` reflects the me/ identity surface + provider-only export module.

## Work Log
- 2026-07-15: Filed from PR #26 architecture review (organizational P1) + pattern-recognition (P3 symmetry).
- 2026-07-15: Full move to `wallets/me/`; `export/` split to a provider-only `WalletExportModule`. Matrix green.
