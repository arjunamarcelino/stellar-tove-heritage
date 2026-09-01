---
status: complete
priority: p2
issue_id: 148
tags: [code-review, performance, database, wallets, TOV-24]
dependencies: []
---

# Bind path does an uncovered `public_key` seq scan inside the write tx + an unused `user` join

## Problem Statement
Two DB-efficiency issues in `bindByowWalletToUser`, both inside or around the write transaction:

1. **Uncovered `public_key` lookup → seq scan.** The only `public_key` index is
   `UQ_wallets_public_key_active … WHERE deleted_at IS NULL` (partial). Both the in-tx
   `repo.findOne({ where: { publicKey }, withDeleted: true })` and `findAnyByPublicKey` query
   `WHERE public_key = $1` with **no** `deleted_at IS NULL` predicate, so Postgres can't use the partial
   index and falls back to a **sequential scan**. The in-tx one runs while holding the write transaction
   open, extending lock duration. Negligible now; O(n) at 100k+ wallets.

2. **Unused `user` relation.** The in-tx `findOne` (and `findAnyByPublicKey`) eager-load
   `relations: { user: true }`, but the bind path only reads `userId`/`deletedAt` (both columns on
   `wallets`). The join is unnecessary work per bind.

## Findings
- `src/modules/wallets/repositories/wallet.repository.ts` — `findAnyByPublicKey` (`withDeleted: true`,
  `relations: { user: true }`).
- `src/modules/wallets/wallets.service.ts` — `bindByowWalletToUser` in-tx `findOne` (`withDeleted: true`,
  `relations: { user: true }`).
- Index inventory: only `UQ_wallets_public_key_active` (partial) and `IDX_wallets_user_id` cover these.
- Performance reviewer (P2 for the index, P3 for the join).

## Proposed Solutions

### Option A: Add a plain `public_key` index + drop the unused `user` join (recommended)
`CREATE INDEX IDX_wallets_public_key ON wallets (public_key)` (new migration), and remove
`relations: { user: true }` from the two pubkey lookups in the bind path.
- **Pros:** Turns the in-tx seq scan into an index lookup (shorter lock window); one fewer joined row/bind.
- **Cons:** A second `public_key` index (small; soft-deletes are rare). Verify with `EXPLAIN`.
- **Effort:** Small · **Risk:** Low

### Option B: Keep the eager `user` load only where a caller needs it
`findOrCreateForWallet` returns `{ user }`, so keep `user` on that path; drop it only in `bindByowWalletToUser`.
- **Pros:** Preserves the login path's shape.
- **Cons:** Requires distinguishing the two callers of `findAnyByPublicKey`.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (plain `public_key` index + drop the unused join), adjusted: the `findAnyByPublicKey` join is
**retained** because the login path consumes it.

## Implemented Solution
- **New migration `1716000000022-AddWalletsPublicKeyIndex`** — plain (non-partial) btree
  `IDX_wallets_public_key ON wallets (public_key)`, so the `withDeleted` lookups (which carry no
  `deleted_at IS NULL` predicate and thus can't use the partial `UQ_wallets_public_key_active`) stop
  seq-scanning inside the bind write transaction. Verified usable via `EXPLAIN` with `enable_seqscan=off`
  → `Index Scan using IDX_wallets_public_key` (the empty test table otherwise picks a seq scan for 1 row;
  the planner switches to the index at real cardinality).
- **Unused `user` join dropped** from the in-tx bind lookup — already done as part of [[147]]'s deterministic
  userId-scoped rewrite (the bind path no longer eager-loads `user`).
- **`findAnyByPublicKey` join retained** — the login path (`findOrCreateForWallet`) returns
  `softDeleted.user` to the SEP-10 verify flow, so the relation is genuinely consumed there. Not stripped.

## Technical Details
Affected: `src/database/migrations/1716000000022-AddWalletsPublicKeyIndex.ts`; the join removal landed in
`wallets.service.ts` via #147. `wallet.repository.ts` unchanged (login uses the `user` relation).

## Acceptance Criteria
- [x] `public_key` lookups have a covering index (validated via `EXPLAIN`/`enable_seqscan=off` → Index Scan;
      planner uses it once the table has real cardinality).
- [x] Bind path no longer joins `user` where the value is unused (via #147); the login path's genuine use is preserved.

## Work Log
- 2026-07-15: Filed from PR #26 performance review (P2 index, P3 join).
- 2026-07-15: Added the `public_key` index migration; the in-tx join was already removed in #147. Test DB
  re-provisioned; index confirmed usable.
