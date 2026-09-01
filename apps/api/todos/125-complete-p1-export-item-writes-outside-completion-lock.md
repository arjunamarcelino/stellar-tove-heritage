---
status: complete
priority: p1
issue_id: 125
tags: [code-review, data-integrity, concurrency, export, TOV-40]
dependencies: []
---

# Export item confirmations commit OUTSIDE the completion-gate transaction

## Problem Statement
The `finalizeIfAllConfirmed` "authoritative guard" takes a `pessimistic_write` lock on the wallet row and re-counts items from the DB before latching `exported`. But the per-item `markItemConfirmed`/`markItemFailed` writes run as their own autocommit UPDATEs (via the `dataSourceRef` getter = the root DataSource, never a transactional manager) BEFORE that transaction opens. So the lock serializes only the final count-and-latch, not the item writes that feed it. Under two concurrent `submit()` calls (or submit racing a resume) the item rows are mutated freely outside any lock, and the caller's in-memory `allConfirmed`/`allZero` gate is computed from a pre-loop `exp.items` snapshot that is never re-read under the lock.

## Findings
- `src/modules/wallets/export/repositories/wallet-export.repository.ts:52,67-68,73-74,113-116` — `dataSourceRef` returns `this.repository.manager.connection` (autocommit); `markItemConfirmed`/`markItemFailed`/`upsertItemBuild` can never join a caller transaction.
- `src/modules/wallets/export/wallet-export.service.ts:233,243` — item status flipped via those autocommit updates inside the loop, before finalize.
- `wallet-export.repository.ts:84-111` — `finalizeIfAllConfirmed` re-counts committed item state under the wallet-row lock (this part holds), but nothing re-guards the *balance* fact under the lock; `allBalancesZero` is computed outside the tx from a pre-loop snapshot (`wallet-export.service.ts:251-263`).
- Money is NOT at risk of double-spend (the OZ auth-entry nonce is single-use and re-simulation refuses a consumed nonce, `soroban-relayer.service.ts`), but the DB tracker can be latched on a stale balance snapshot and item state can flap under concurrency.

## Proposed Solutions

### Option A: Thread an EntityManager through the item mutations + confirm the final item inside the finalize tx
- **Description:** Add an optional `manager?: EntityManager` to `markItemConfirmed`/`markItemFailed`/`upsertItemBuild` (mirroring `InternalAuditLogRepository.record` and `WalletRepository.markExported`). In the completion path, do the last item confirmation + the wallet latch + the audit row in one transaction, and re-read item state under the lock.
- **Pros:** Makes the "authoritative guard" actually authoritative; consistent with the established manager-threading pattern; removes the ad-hoc autocommit getter as a mutation path.
- **Cons:** Larger refactor of the submit loop (per-item send happens on-chain first, so the DB confirm can still be a separate write — needs care to keep verify→submit→DB-last ordering).
- **Effort:** Medium
- **Risk:** Medium

### Option B: Document that on-chain state is the real double-spend guard; keep DB tracker best-effort
- **Description:** Accept the current design (chain nonce prevents double-spend), and explicitly document that the DB tracker is advisory and `allBalancesZero` is a best-effort external input; keep the row-locked DB re-count as the latch guard but state its limits.
- **Pros:** Minimal change; the money-safety property genuinely rests on the chain.
- **Cons:** Leaves the item-status flap under concurrency; the "FOR UPDATE guard" comment overstates the guarantee.
- **Effort:** Small
- **Risk:** Low (money) / Medium (tracker correctness)

## Recommended Action
Atomic item claim / CAS (confirmed with the owner) — chosen over threading a manager through the loop,
because holding the wallet `FOR UPDATE` lock + a DB transaction across N slow on-chain sends (~5-7s each)
would hold a pessimistic lock across network I/O.

## Implemented Solution
Added `claimItemForSubmit(itemId): Promise<boolean>` to the export repo — a single atomic
`UPDATE wallet_export_items SET status='submitted' WHERE id=$1 AND status IN ('pending','failed')` that
returns whether this caller won the claim. The submit loop now claims each item before sending; a
concurrent submit that loses the CAS (row already `submitted`/`confirmed`) reports the item as in-flight
(`submitted`) and does NOT re-send it — single-writer per item. This removes the confirmed↔failed flap
under concurrent submits without holding a long transaction.

The existing `finalizeIfAllConfirmed` (wallet-row `FOR UPDATE` + DB re-count) remains the authoritative
latch guard: a request whose in-memory items aren't all confirmed simply doesn't latch; the DB re-count
never latches `exported` while an item is non-`confirmed`. The unused `'submitted'` item status now has a
real writer (both the claim and the lost-claim report), so it is retained (updates [[140]]).

Residual (out of scope here, tracked separately): a crash AFTER on-chain success but BEFORE
`markItemConfirmed` leaves the item stuck `submitted` — that's the crash-window reconciliation in [[127]]
(reconcile-by-ledger). Double-spend is prevented regardless by the single-use on-chain auth nonce.

## Technical Details
Affected: `src/modules/wallets/export/repositories/wallet-export-repository.interface.ts` (+`claimItemForSubmit`),
`.../wallet-export.repository.ts` (impl, `In` import), `.../wallet-export.service.ts` (submit loop claim),
`test/integration/.../wallet-export-constraints.integration.spec.ts` (+CAS transition test).

## Acceptance Criteria
- [x] Concurrent submits cannot re-send the same item (single-writer CAS) or flap its terminal status.
- [x] The latch decision stays authoritative via `finalizeIfAllConfirmed`'s row-locked DB re-count.
- [x] Integration test proves the CAS guard (pending→submitted wins; submitted/confirmed cannot be re-claimed; failed is re-claimable).

## Work Log
- 2026-07-14: Filed from PR #25 review (data-integrity + typescript reviewers).
- 2026-07-15: Implemented the atomic item-claim CAS. build + lint + 305 unit / 38 integration / 74 e2e green. Marked complete. Crash-window residual tracked in [[127]].
