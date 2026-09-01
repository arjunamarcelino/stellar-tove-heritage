---
status: complete
priority: p3
issue_id: 142
tags: [code-review, security, compliance, export, TOV-40]
dependencies: []
---

# Audit completeness: per-item success/failure rows + fix EXPORT_CONFIRMED actor semantics

## Problem Statement
Audit coverage records `EXPORT_REQUESTED`, `EXPORT_SUBMIT` (aggregate), and `EXPORT_CONFIRMED` (in the finalize tx), but NOT individual per-item successes/failures. A partial drain that moves 3 of 5 holdings then fails leaves no audit-log trail of *which* items moved — that lives only in `wallet_export_items.tx_hash`, not the append-only ledger. Also, the `EXPORT_CONFIRMED` row uses `actorType: 'system'` but `actorId: userId` — a system actor carrying a user id, which may confuse audit queries.

## Findings
- `src/modules/wallets/export/wallet-export.service.ts:264-281` — aggregate confirm audit only; no per-item rows.
- `wallet-export.service.ts:271-272` — `actorType:'system'` + `actorId:userId` mismatch.
- `AUDIT_KIND.EXPORT_FAILED` exists but is never emitted (see [[140]]).

## Proposed Solutions

### Option A: Emit per-item audit rows + reconcile actor semantics
- **Description:** Write an audit row per item on confirm/fail (tx_hash + token + amount), and set `actorType`/`actorId` consistently (e.g. `actorType:'user'` for a user-initiated confirm, or drop `actorId` for `'system'`). Wire `EXPORT_FAILED` for per-item failures if a failure trail is wanted.
- **Pros:** Forensic/AML reconstruction of exactly what moved; consistent actor semantics.
- **Cons:** More audit rows; decide the actor convention.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Per-item audit rows + actor fix (confirmed).

## Implemented Solution
Added a per-item audit row in the submit loop via a new `auditItem` helper (subject_type
`wallet_export_item`, subject_id = the item): on confirm → `EXPORT_CONFIRMED` with
`{ export, tokenContract, amountScaled, txHash, ledger }`; on failure (relayer error OR mid-loop
allowlist revocation) → `EXPORT_FAILED` with `{ export, tokenContract, errorCode }`. So a partial drain is
fully reconstructable from the append-only ledger (which items moved, which failed and why), not just from
`wallet_export_items`. `EXPORT_FAILED` (previously unused) now has a writer.

Fixed the actor semantics: the export-level `EXPORT_CONFIRMED` on the submit path is now `actorType:'user'`
(was the odd `'system'` + `actorId:userId`); the lazy reconciliation path (todo 127) stays
`actorType:'system'` with `actorId:null` (genuinely system-initiated).

## Technical Details
Affected: `wallet-export.service.ts` (`auditItem` helper + 3 per-item call sites + the finalize actor).
E2e asserts two `wallet_export_item` confirmed audit rows for a 2-holding export and that the export-level
confirm is a `user` actor.

## Acceptance Criteria
- [x] Per-item money movements are individually auditable in `internal_audit_log`.
- [x] Actor fields are internally consistent (user-initiated vs system reconciliation).

## Work Log
- 2026-07-14: Filed from PR #25 review (security reviewer, informational).
- 2026-07-15: Added per-item confirm/fail audit rows + fixed actor semantics + e2e. build + lint + 10 e2e green. Marked complete.
