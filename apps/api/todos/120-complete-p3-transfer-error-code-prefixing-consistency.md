---
status: complete
priority: p3
issue_id: 120
tags: [code-review, quality, conventions]
dependencies: []
---

# Transfer error codes span three prefixes (RELAYER_/TRANSFER_/WALLET_) for one feature — document or consolidate

## Problem Statement
The passkey-signed transfer feature (TOV-22) introduces error codes under three different domain
prefixes for a single feature surface. The project convention is one domain prefix per feature, but
this 3-way split has no recorded justification — unlike other intentional deviations that are
explicitly flagged in module docs.

## Findings
- `src/common/enums/error-code.enum.ts` (~lines 22-31) adds: `WALLET_NOT_FOUND`,
  `RELAYER_SIGNATURE_REQUIRED`, `RELAYER_SIGNATURE_INVALID`, `RELAYER_UNAVAILABLE`, `TRANSFER_EXPIRED`,
  `TRANSFER_SIMULATION_FAILED`, `TRANSFER_FAILED`.
- The convention (`common/CLAUDE.md`: error codes "prefixed with domain") and the deploy path
  (`WALLET_DEPLOY_FAILED`) point to one domain prefix per feature.
- The 3-way split is defensible — `RELAYER_*` names WHERE the failure originates (the relayer port),
  `TRANSFER_*` names the transfer semantics — but there is no recorded rationale, unlike the
  deliberately un-prefixed `PASSKEY_ALREADY_BOUND` which `auth/CLAUDE.md` explicitly flags.

## Proposed Solutions

### Option A: Consolidate to a single `TRANSFER_*` prefix
- Rename to `TRANSFER_SIGNATURE_INVALID`, `TRANSFER_UNAVAILABLE`, `TRANSFER_SIGNATURE_REQUIRED`, etc.
- **Effort:** Small — but touches error-code consumers and tests.
- **Risk:** Low

### Option B: Document the intentional spread
- Add a one-line note in `auth/CLAUDE.md` (or near the enum block) recording that
  `RELAYER_*`/`TRANSFER_*`/`WALLET_*` are intentionally split (relayer-origin vs transfer-semantics vs
  resource-not-found).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
**Resolved by consolidating to the `TRANSFER_*` prefix.** Renamed the relayer-origin codes:
`RELAYER_SIGNATURE_REQUIRED → TRANSFER_SIGNATURE_REQUIRED`,
`RELAYER_SIGNATURE_INVALID → TRANSFER_SIGNATURE_INVALID`,
`RELAYER_UNAVAILABLE → TRANSFER_UNAVAILABLE`. The transfer surface now uses a single `TRANSFER_*`
domain (plus `WALLET_NOT_FOUND`, a genuine wallet-domain code). Enum + `WalletTransferService` +
unit/e2e assertions updated.

## Technical Details
- File: `src/common/enums/error-code.enum.ts` (~lines 22-31).
- Consumers: `wallet-transfer.service.ts` (`mapTransferError`), any error-code assertions in tests.
- Precedent for documented-deviation: `PASSKEY_ALREADY_BOUND` note at `error-code.enum.ts:18-19`.

## Acceptance Criteria
- [x] Prefixing is consistent — single `TRANSFER_*` domain for the transfer surface (+ `WALLET_NOT_FOUND`).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: renamed the 3 `RELAYER_*` codes to `TRANSFER_*` across enum + service + tests.
  Build + unit (7) + e2e (7) green.
