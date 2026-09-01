---
status: complete
priority: p2
issue_id: 084
tags: [code-review, security, data-integrity, tov-20]
dependencies: []
---

# Soft-Deleted Wallet + Reused `public_key` Silently Forks a New User (Ban/Offboard Bypass)

## Problem Statement
`WalletsService.findByPublicKey` uses `repository.findOne` with no `withDeleted`, so TypeORM excludes
soft-deleted rows, and the partial-unique index `UQ_wallets_public_key_active ... WHERE deleted_at IS NULL`
only enforces uniqueness among *active* wallets. If a wallet is ever soft-removed (the capability exists via
`BaseRepository.softRemove`, even if no endpoint wires it today), a later SEP-10 login with the same key
finds nothing, passes the partial-unique index, and mints a **brand-new user** — orphaning the prior user's
data and bypassing whatever the soft-delete meant (offboard/ban). Latent now (no delete path), but the index
design actively enables it.

## Findings
- `src/modules/wallets/repositories/wallet.repository.ts:13-18` — `findByPublicKey` does not consider
  soft-deleted rows (`withDeleted` not set).
- `src/modules/wallets/wallets.service.ts:30-33,44-46` — miss → creates a fresh user + wallet.
- Partial unique index only covers `deleted_at IS NULL` (migration `:34-37`).

## Proposed Solutions

### Option A: Look up including soft-deleted; decide policy explicitly
- **Description:** `findByPublicKey` queries `withDeleted`. If a soft-deleted wallet is found: either reject
  auth (banned) or reactivate (`UPDATE ... SET deleted_at = NULL`) rather than insert a new user.
- **Pros:** Closes the ban/offboard bypass; no orphaned users.
- **Cons:** Needs a product decision (reject vs reactivate).
- **Effort:** Small-Medium
- **Risk:** Low

### Option B: Document the invariant + block soft-delete on wallets for now
- **Description:** Since no delete path exists, add a comment/guard that wallets must not be soft-deleted
  until re-auth semantics are decided.
- **Pros:** Cheap; prevents accidental introduction.
- **Cons:** Doesn't solve it if a delete path is added later.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — reactivate (user-confirmed): on re-auth of a soft-deleted wallet, restore it and return the
original user (no ban feature exists yet, so reactivation is the sensible default and prevents forking).

## Implemented Solution
- `IWalletRepository` gains `findAnyByPublicKey` (`withDeleted: true`) and `restore` (`repository.recover`).
- `WalletsService.findOrCreateForWallet` now: (1) active lookup → return; (2) else look up including
  soft-deleted — if found, `restore()` (clears `deleted_at`) and return the original user; (3) else create.
  Since step 1 already returned for any active row, restoring can't violate the partial-unique index.
- Added integration test `test/integration/modules/wallets/wallets.service.integration.spec.ts` (3 cases:
  first-sight create, returning-active reuse, and **soft-deleted → reactivated same user/wallet, no fork**).

## Technical Details
- Changed: `src/modules/wallets/repositories/wallet-repository.interface.ts`,
  `src/modules/wallets/repositories/wallet.repository.ts`, `src/modules/wallets/wallets.service.ts`.
- Added: `test/integration/modules/wallets/wallets.service.integration.spec.ts`.

## Acceptance Criteria
- [x] A soft-deleted wallet re-authenticating cannot create a second user — it reactivates the original (integration-tested).
- [x] Semantics are explicit (reactivate) and covered by an integration test.

## Work Log
- 2026-07-02: Filed from PR #20 review (data-integrity-guardian, P2).
- 2026-07-02: Fixed — reactivate-on-reauth + integration test (3/3), e2e still 7/7. Marked complete.
