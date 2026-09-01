---
status: complete
priority: p3
issue_id: 166
tags: [code-review, audit, wallets, tov-25, product-decision]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (full), enabled by the neutral-module extraction in [[158]]. `WalletsService` now injects
`AuditLogService` and emits a `PRIMARY_CHANGED` audit row with `reason: 'initial'` in-transaction whenever a
wallet is first designated primary:
- `findOrCreateForWallet` — genesis primary at SEP-10 login (new user's first wallet);
- `createEmbeddedPasskeyWallet` — genesis primary at passkey registration;
- `bindByowWalletToUser` — add-path self-heal (a bound wallet becomes primary when the user has no live one);
- `reactivateRow` — a reactivated wallet promoted to primary (covers login + add reactivation).
Via the shared `recordPrimaryDesignated(manager, userId, walletId)` helper (atomic with the write). The audit
trail can now reconstruct primary history from origin. Full suites green (339 unit / 73 integration / 90 e2e);
build + lint clean. (Migration backfill history remains unrecoverable — pre-existing, out of scope.)

# Audit completeness: first-time primary designation is not audited

## Problem Statement
The `internal_audit_log` now records subsequent primary *changes* (`PRIMARY_CHANGED`, reason `user` or
`auto_promote`), but not how a wallet *first* became primary: the initial designation at bind time
(`WalletsService.findOrCreateForWallet` / `bindByowWalletToUser` computing `isPrimary`) and the TOV-24
migration backfill emit no audit row. So the audit log cannot fully reconstruct a wallet's primary history
from origin — only from the first user-driven change onward. If the audit trail is meant to support settlement
disputes, the initial designation is a gap.

## Findings
- `me-wallets.service.ts` / `wallets.service.ts` — audit rows written only in `setPrimary` and
  `removeWallet` auto-promote paths.
- Bind-time primary (`findOrCreateForWallet`, `bindByowWalletToUser` first-wallet `isPrimary:true`) and
  migration `1716000000020` backfill: no audit row.

## Proposed Solutions
### Option A: Emit a `PRIMARY_CHANGED` (or `PRIMARY_DESIGNATED`) row on first designation
- Record an audit row when a wallet is first made primary at bind time (reason e.g. `initial`/`bind`).
- **Pros:** complete primary history from origin. **Cons:** touches the bind path (which is on the SEP-10
  login hot path); backfill history still unrecoverable. **Effort: Small–Medium.**

### Option B: Accept the gap; document it
- **Pros:** no change to the hot path. **Cons:** audit history starts at first change, not origin.
  **Effort: Small (doc only).**

## Recommended Action
_(triage — product decision on whether dispute reconstruction needs origin)_

## Technical Details
- Files: `src/modules/wallets/wallets.service.ts` (bind/first-primary paths), `audit-log.types.ts` (maybe a
  new kind).

## Acceptance Criteria
- [ ] Product decision recorded on whether first-designation must be audited.
- [ ] If yes: bind-time primary designation emits an audit row; documented either way.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (security-sentinel, audit completeness).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
