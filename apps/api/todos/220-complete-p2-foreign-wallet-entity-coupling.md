---
status: complete
priority: p2
issue_id: 220
tags: [code-review, architecture, correctness, TOV-233, PR-32]
dependencies: []
---

# Backoffice service binds the foreign Wallet entity and hand-rolls primary-settlement-wallet resolution (money-adjacent payout address)

## Problem Statement
The backoffice artworks service binds the foreign `Wallet` entity and hand-writes the primary-settlement-wallet resolution query that the `wallets` module owns. This duplicated domain knowledge can silently resolve the WRONG artist payout address, which is baked on-chain into `TokenInit.artist`.

## Findings
- `src/modules/backoffice/artworks/backoffice-artworks.module.ts` ~line 25 `TypeOrmModule.forFeature([Wallet])`.
- `backoffice-artworks.service.ts` ~lines 42, 190-196 `resolvePrimaryWalletAddress` hand-writes `{ isPrimary:true, status:'active', deletedAt:IsNull() }` + `contractAddress ?? publicKey`.
- This duplicates domain knowledge the `wallets` module owns (`WalletsService` is the authority on primary-wallet resolution / `UQ_wallets_primary_active`). If wallets changes primary selection or the C-vs-G precedence, this query silently resolves the WRONG artist payout address (baked into `TokenInit.artist`/`artist_payout` on-chain).
- The `contractAddress ?? publicKey` fallback also silently yields a G-address payout for a wallet without a deployed contract — an implicit policy hidden in a `??`.

## Proposed Solutions
### Option A (recommended): depend on WalletsService, not the entity
- Expose a narrow `WalletsService.resolvePrimarySettlementAddress(userId): Promise<string|null>` and depend on it (import the neutral `WalletsModule`, inject the service) rather than `forFeature([Wallet])`.
- Make the C/G intent explicit rather than hidden in a `??`.
- **Effort:** Medium.

## Recommended Action
**RESOLVED (Option A).** Added `WalletsService.resolvePrimarySettlementAddress(userId)` — the single authority on which address settles for a user (embedded → contract C…, byow → public key G…) — and the backoffice service now depends on it (imports the neutral `WalletsModule`, injects `WalletsService`) instead of `TypeOrmModule.forFeature([Wallet])` + a hand-written `Repository<Wallet>` query. The primary-selection rule (`isPrimary && status==='active'`, C-over-G precedence) now lives in one place, so a future change in the wallets domain can't silently drift the artist payout address baked into `TokenInit`. Unit test updated to mock the new method.

## Technical Details
- Affected: `src/modules/backoffice/artworks/backoffice-artworks.module.ts` (~line 25); `src/modules/backoffice/artworks/backoffice-artworks.service.ts` (~lines 42, 190-196).
- Authority: `WalletsService` / `UQ_wallets_primary_active`.
- The resolved address is written on-chain into `TokenInit.artist` / `artist_payout`, so a wrong resolution is durable.

## Acceptance Criteria
- [ ] The service resolves the primary settlement address via `WalletsService`, not a hand-written query over `Wallet`.
- [ ] `forFeature([Wallet])` is removed from the backoffice artworks module.
- [ ] The C-address-vs-G-address payout policy is explicit, not an implicit `??` fallback.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — primary-address resolution moved to WalletsService; build + 37 tests green.
