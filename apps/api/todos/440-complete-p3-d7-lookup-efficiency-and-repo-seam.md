---
status: complete
priority: p3
issue_id: 440
tags: [code-review, tov-243, pr-57, performance, wallets, repository]
dependencies: []
---
# D7 binding lookup hydrates an unused `user` JOIN and fans out N single-key queries

## Resolution (2026-08-27) — Option 1: purpose-built batch finder
**Applied:**
- New `IWalletRepository.findActiveByowPublicKeysIn(publicKeys[]): Promise<string[]>` + impl — one
  `WHERE public_key IN (…)` with `select: { publicKey: true }` (no `user` relation), live rows only.
- Replaced the singular `WalletsService.isKnownActiveByowAddress` (added this PR, only D7 used it) with
  `filterKnownActiveByowAddresses(publicKeys[]): Promise<Set<string>>` — one query for the whole batch.
- `flagUnboundExternalAdds` now collects the G-adds and makes a single call, returning the set-difference
  (submitted G-adds minus known bindings). No JOIN, no N round-trips.
- Tests: reworked the 3 D7 unit cases to the batch mock; added a wallets integration test proving the query
  excludes soft-deleted + unknown keys and byow-scopes. Build clean; service unit 21 / wallets int 57 green.

## Problem Statement
The D7 confused-deputy check performs a per-G-address existence probe, but does so with a heavier query
than needed and one round-trip per address. It's an advisory, bounded (batch ≤10) path — so this is
efficiency/consistency polish, not a scalability risk — but it deviates from the module's purpose-built
finder convention.

## Findings
1. **Unused relation hydration** — `src/modules/wallets/wallets.service.ts:359`
   (`isKnownActiveByowAddress`) calls `walletRepo.findByPublicKey(publicKey)` and discards everything but
   nullness. `findByPublicKey` (`src/modules/wallets/repositories/wallet.repository.ts:15-20`) eager-loads
   `relations: { user: true }`, so every boolean probe LEFT-JOINs and materializes the bound `User`. The
   lookup is index-served (no scan), but the JOIN is pure waste for a `!== null`.
2. **No lightweight primitive reachable** — `BaseRepository.exists`/`existsBy`
   (`src/common/repositories/base.repository.ts:79`, `SELECT 1 … LIMIT 1`, no join) is exactly right, but
   `IWalletRepository` (`wallet-repository.interface.ts`) does NOT extend `IBaseRepository`, so
   `WalletsService` (correctly injecting the interface token) can't reach it.
3. **N single-key queries** — `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts:242-252`
   maps the G-adds to `Promise.all(gAdds.map(i => this.wallets.isKnownActiveByowAddress(i.wallet)))` — up
   to 10 separate round-trips, each also carrying the redundant JOIN. A single `WHERE public_key IN (:...)`
   would collapse this to one query.

## Proposed Solutions
1. **Add a purpose-built finder (recommended, Small).** Add `existsActiveByPublicKey(publicKey)` (or a
   batch `filterKnownActiveByowAddresses(keys[])` returning the known `Set`) to `IWalletRepository` +
   `WalletRepository`, backed by an `exists`/`IN (…)` query with no `user` relation. Point
   `isKnownActiveByowAddress` (or a new `filter…` method) at it. Pros: matches the module's finder pattern
   (`findOwnedById`, `findEmbeddedWalletByUserId`); one query for the whole batch; the "LIVE rows only"
   guarantee lives on a method whose name states it. Cons: a little more surface than the current reuse.
2. **Leave as-is (accept).** Batch ≤10, pool max 20, advisory path — the JSDoc's "bounded parallelism is
   unnecessary" is defensible. Pros: zero change. Cons: keeps the wasteful JOIN + N round-trips.

## Recommended Action
_(triage — option 1 if touched; otherwise accept)_

## Technical Details
- Files: `wallets.service.ts`, `repositories/wallet.repository.ts`, `wallet-repository.interface.ts`,
  `backoffice-kyc-allowlist.service.ts` (D7 call-site).

## Acceptance Criteria
- [ ] The D7 binding check runs without hydrating the `user` relation.
- [ ] (If batch form) a mixed G-batch performs one `wallets` query, not N.
- [ ] Existing D7 unit tests still pass (bound → no flag; unbound → flag; C → skipped).

## Work Log
- 2026-08-27: Raised by performance-oracle (P3-1/P3-2), architecture-strategist (P3), kieran (P3) in PR #57.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
