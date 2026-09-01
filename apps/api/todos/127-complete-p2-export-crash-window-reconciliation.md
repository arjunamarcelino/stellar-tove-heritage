---
status: complete
priority: p2
issue_id: 127
tags: [code-review, reliability, export, TOV-40]
dependencies: [125]
---

# Crash window: a settled transfer can be stuck recorded as `pending` (unreconcilable export)

## Problem Statement
The per-item transfer is submitted and polled to on-chain SUCCESS *before* `markItemConfirmed` writes the tx hash. If the process crashes (or the DB write fails) after on-chain SUCCESS but before that update, the item stays `pending` with a stale `unsigned_tx_xdr`. On resume, `initiate` re-reads live holdings; the drained token now reads zero so no new transfer is built for it (safe — no double-spend, protected by the on-chain nonce). BUT the item is never reconciled to `confirmed`, so `exp.items.every(confirmed)` is false forever and the wallet can never latch `exported` despite all funds being gone. This is a stuck-export / availability defect on a money surface.

## Findings
- `src/modules/wallets/export/wallet-export.service.ts:218-233` — submit → poll SUCCESS → THEN `markItemConfirmed`; crash between the two leaves `pending`.
- `wallet-export.service.ts:251` — `allConfirmed` requires every item `confirmed`; a stuck `pending` blocks the latch permanently.
- Double-spend is genuinely prevented (nonce single-use + re-simulation refusal), so this is availability, not fund loss.

## Proposed Solutions

### Option A: Persist the tx hash before polling, then reconcile by ledger
- **Description:** Write `submitted` + `tx_hash` before `pollForTransfer`; on resume (or in the status read), for a `submitted`/`pending` item with a stored hash, call `getTransaction(hash)` — if SUCCESS, mark `confirmed`.
- **Pros:** Recoverable breadcrumb; authoritative reconciliation via the ledger (matches the "never branch on error text — read the ledger" learning).
- **Cons:** Adds a `submitted` state write + a reconcile path; one more RPC on resume.
- **Effort:** Medium
- **Risk:** Low

### Option B: On resume, treat a pending item whose token now reads zero as confirmed
- **Description:** If a `pending` item's token balance is zero and it had a prior submission, mark it confirmed.
- **Pros:** Simple; no schema change.
- **Cons:** Weaker proof (zero balance ≠ this item's tx moved it); could mask a genuinely-unsent item that happens to read zero.
- **Effort:** Small
- **Risk:** Medium

## Recommended Action
Option B — balance re-read reconciliation (confirmed with the owner). No relayer/TOV-22 refactor.

## Implemented Solution
Lazy crash-recovery driven by the status endpoint (the FE's reconciliation-poll path). `status()` now,
when the latest export has any `submitted` item, calls `reconcileStuckItems`: it reads the live balance
of those tokens and, for any token that is verifiably drained (zero), reconciles the item to `confirmed`
(`reconcileItemConfirmed` — guarded to `submitted` rows; the lost tx hash stays null). If reconciliation
completes the export, it latches the wallet via the same `finalizeIfAllConfirmed` gate (with a
`reconciled: true` audit row). This is safe for the single-drain-per-token model: an embedded wallet only
moves funds via the relayer, so a zero balance for a `submitted` item reliably means its transfer landed.
Reconciliation lives in `status()` rather than `initiate()` precisely because a fully-drained wallet would
otherwise hit the empty-wallet 422 in initiate before it could reconcile. Double-spend remains impossible
regardless (single-use on-chain auth nonce), so this only recovers a stuck tracker.

## Technical Details
Affected: `src/modules/wallets/export/repositories/wallet-export-repository.interface.ts` +
`wallet-export.repository.ts` (`reconcileItemConfirmed`), `wallet-export.service.ts`
(`reconcileStuckItems` + `status()` hook). E2e simulates a crash (item forced `submitted` + balance
drained) and asserts the status read reconciles it and latches the wallet `exported`.

## Acceptance Criteria
- [x] A crash between on-chain SUCCESS and the DB confirm is recoverable via the status read.
- [x] The wallet latches `exported` after such a crash.
- [x] E2e covers it.

## Work Log
- 2026-07-14: Filed from PR #25 review (security reviewer).
- 2026-07-15: Implemented Option B (balance-reread reconciliation on status) + e2e. build + lint + 9 export e2e green. Marked complete.
