---
status: complete
priority: p2
issue_id: 428
tags: [code-review, tov-33, pr-56, data-integrity, provenance, concurrency]
dependencies: []
---
# Concurrent `initiate` can write duplicate `custody_transfer` provenance rows

## Resolution (2026-08-27) — Solution 1 (DB partial-unique)
- **Migration `1716000000055-AddWalletRotationItemTokenUnique.ts`**: partial-unique
  `UQ_wrti_rotation_token (rotation_id, token_contract) WHERE deleted_at IS NULL` — one item per token is now
  authoritative at the DB, even under concurrent initiate; `WHERE deleted_at IS NULL` lets a softCancel + fresh
  rotation re-create the same token.
- **`wallet-rotation.repository.ts` `upsertItemBuild`**: now find-or-create by (rotation, token) with an
  `isUniqueConstraintError` catch → re-read the winner and apply onto it (no duplicate item ⇒ no duplicate
  `custody_transfer` row downstream).
- **Test**: integration spec asserts a second "fresh build" for the same token reuses the row (count == 1) and a
  raw duplicate insert is rejected by the index. Rotation integration 7/7, build 0 issues.

## Problem Statement
`registry_events` is an immutable, append-only provenance ledger whose whole purpose is "exactly one
`custody_transfer` row per confirmed on-chain transfer". A concurrency gap in the rotation item model lets it
over-report a single on-chain transfer as TWO custody rows — corrupting an append-only (uncorrectable) ledger.
Money is safe (the on-chain full-balance drain + re-simulation is the hard backstop), but the audit guarantee the
table exists for is violated.

## Findings
- `initiate` has no `Idempotency-Key`. The `UQ_wrt_source_active` index serializes concurrent initiates to ONE
  rotation, but each caller then loads `rotation.items` (empty) and runs the build loop before either inserts —
  and `wallet_rotation_transfer_items` has **no `UNIQUE(rotation_id, token_contract)`**, so both insert a
  separate item row for the same token, each carrying the full balance.
  - Migration `1716000000053-CreateWalletRotationTransferTables.ts` (items table — no such index)
  - `src/modules/wallets/rotation/repositories/wallet-rotation.repository.ts:62-73` (`upsertItemBuild`)
- **Failure scenario:** item A drains the balance on-chain and confirms (registry row `rotation_item:A`). Item B
  re-simulates → fails (zero balance) → `markItemFailed`. Then `status()` → `reconcileStuckItems` sees B's token
  balance is now 0 → `reconcileItemConfirmed(B)` confirms it and writes a SECOND `custody_transfer` row
  `rotation_item:B` — same from/to/token/amount as A. `source_ref` idempotency is **per-item**, so it cannot dedup
  two items representing one real transfer. The immutable ledger now double-counts the transfer.
- The export precedent (`wallet_export_items`, migration 016) also lacks this unique, but export has no provenance
  ledger, so the duplicate-row consequence is **net-new** here. (data-integrity-guardian P2)

## Proposed Solutions
1. **Partial-unique index `(rotation_id, token_contract) WHERE deleted_at IS NULL`** on
   `wallet_rotation_transfer_items` (add inline to migration 053 — new table, no CONCURRENTLY). `upsertItemBuild`
   then relies on find-or-create per (rotation, token); a lost race catches 23505 and re-reads.
   Pros: closes the gap at the DB (authoritative); cheap. Cons: `upsertItemBuild` needs a 23505 re-read path.
   Effort: Small.
2. **Serialize the build loop under the source-wallet `pessimistic_write` lock** (same lock
   `finalizeIfAllConfirmed` already takes). Pros: no schema change. Cons: holds a lock across N relayer
   `buildTransfer` calls (simulate RPC) — violates the "no long work under a row lock" discipline. Effort: Small.
   **Not recommended** (RPC under lock).
3. **Accept + document** (chain backstop makes it money-safe). Cons: leaves the provenance ledger corruptible —
   defeats the table's reason to exist. Not recommended.

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] Two concurrent `initiate` calls for the same source produce at most one item per `token_contract`.
- [ ] A confirmed transfer yields exactly one `registry_events` row even under the reconcile-after-failed-duplicate
      scenario above (integration test).

## Resources
- PR #56 (base develop); reviewer: data-integrity-guardian.
