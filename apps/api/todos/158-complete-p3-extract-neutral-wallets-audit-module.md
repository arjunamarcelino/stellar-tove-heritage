---
status: complete
priority: p3
issue_id: 158
tags: [architecture, wallets, audit, tov-25, layering]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Extracted early (ahead of the "3rd consumer" trigger) because [[166]] needed `WalletsService` to emit audit
rows without depending on the export module. Moved `audit-log.service.ts`, `audit-log.types.ts`, the
`InternalAuditLog` entity, and the repo + interface from `wallets/export/` into a new neutral
`wallets/audit/` behind `WalletsAuditModule` (provides + exports `AuditLogService`; owns
`TypeOrmModule.forFeature([InternalAuditLog])`). `WalletExportModule`, `WalletsModule`, and
`PublicMeWalletsModule` now import it; `WalletExportModule` no longer provides/exports audit. No schema change
(table + append-only trigger + migrations unchanged; entity file moved within the glob). Import paths updated
across export/me/service + the moved unit test. Full suites green; build + lint clean.

# Extract a neutral WalletsAuditModule

## Problem Statement
`AuditLogService` + the `internal_audit_log` entity/repo/types physically live under
`src/modules/wallets/export/` (TOV-40), but the audit facility is a cross-cutting concern, not
export-specific. TOV-25 (primary settlement wallet) made the `me/` identity surface the **first
non-export consumer**: `MeWalletsService` now injects `AuditLogService` to record `PRIMARY_CHANGED`
rows. This was wired minimally by adding `AuditLogService` to `WalletExportModule`'s `exports` — safe
today because the `me → export` module import already existed (no new edge, no cycle), but it leaves the
me-surface depending on the *export* module for an audit concern that isn't export's.

## Findings
- `src/modules/wallets/export/audit-log.service.ts` — `AuditLogService` (now consumed by `me/` too).
- `src/modules/wallets/export/wallet-export.module.ts` — exports `AuditLogService` (debt note in header).
- `src/modules/wallets/export/audit-log.types.ts` — `AUDIT_KIND` now includes `PRIMARY_CHANGED` (TOV-25).
- `src/modules/wallets/me/me-wallets.service.ts` — injects `AuditLogService`.
- Precedent: the `files/` neutral module (root `CLAUDE.md` → "API Surfaces") — a domain shared by two
  surfaces lives in its own neutral module that each surface imports.

## Trigger to act
The **next audit-writing surface outside export** — it will NOT ride the existing `me → export` import,
so that is the forcing function. At that point, extract a neutral `WalletsAuditModule`:
`AuditLogService` + `InternalAuditLog` entity + `INTERNAL_AUDIT_LOG_REPOSITORY` repo/interface +
`audit-log.types.ts` (+ the append-only trigger migration references), imported by `WalletExportModule`,
`PublicMeWalletsModule`, and the new consumer.

## Proposed Solution
Move the audit files into `src/modules/wallets/audit/` behind a `WalletsAuditModule` that provides +
exports `AuditLogService`. Update `WalletExportModule` to import it (drop the local providers/exports),
update the me-surface import, keep the DB table/trigger + migration unchanged (code-only move). Verify the
export + primary-wallet audit tests still pass.

## Effort
Small–Medium (file moves + module rewiring + import updates; no schema change).
