---
status: complete
priority: p2
issue_id: 131
tags: [code-review, architecture, dead-code, export, TOV-40]
dependencies: [125]
---

# Export repo writes the Wallet `exported` latch inline; markWalletExported/markExported are dead code

## Problem Statement
`finalizeIfAllConfirmed` acquires the wallet-row lock and issues `manager.getRepository(Wallet).update({id, status:'active'}, {status:'exported', removedAt})` inline — byte-for-byte the same guarded transition already implemented as `WalletRepository.markExported` and exposed via `WalletsService.markWalletExported`. But those two methods are NEVER called (dead code). So (1) a repository in the `export` aggregate is the write-authority for the `Wallet` lifecycle latch that the neutral `wallets` aggregate should own (leaky boundary), and (2) the guarded-transition invariant (`status='active'` precondition + `removed_at` co-move for `CHK_wallets_exported_removed_at`) now lives in two places and can drift, while the intended seam sits unused as a trap for the next author.

## Findings
- `src/modules/wallets/export/repositories/wallet-export.repository.ts:98-100` — inline Wallet update.
- `src/modules/wallets/repositories/wallet.repository.ts:61-68` — `markExported` (never called).
- `src/modules/wallets/wallets.service.ts:120-122` — `markWalletExported` (never called).

## Proposed Solutions

### Option A: Route the Wallet flip through WalletsService.markWalletExported(walletId, manager)
- **Description:** Keep the wallet-row lock + export-item recount in the export repo (those are export-owned rows), but perform the `Wallet.status` flip via the wallets aggregate's seam, passing the transaction manager. Delete whichever of the inline update / dead pair remains unused.
- **Pros:** Keeps the Wallet lifecycle behind its own aggregate; single source of the guarded transition; removes dead code; composes with [[125]]'s manager threading.
- **Cons:** Slight coupling of the export finalize to WalletsService (already imported).
- **Effort:** Small
- **Risk:** Low

### Option B: Delete the dead pair, keep the inline update, document the boundary exception
- **Description:** Accept the export repo owning the latch write; remove `markExported`/`markWalletExported`.
- **Pros:** Smallest change.
- **Cons:** Leaves the boundary violation; two-place invariant risk remains if a similar flip is added elsewhere.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — route the Wallet flip through `WalletsService.markWalletExported(manager)` (confirmed).

## Implemented Solution
`finalizeIfAllConfirmed` now takes a `latchWallet: (manager) => Promise<boolean>` callback instead of
issuing the `Wallet` UPDATE inline. The export service passes
`(m) => this.walletsService.markWalletExported(walletId, m)` at both finalize call sites (submit + the
todo-127 reconciliation), so the `Wallet` `active -> exported` write goes through the wallets aggregate's
own guarded seam — which was previously dead code. The export repo keeps only the wallet-row `FOR UPDATE`
lock + the item recount (export-owned consistency); it no longer writes the `Wallet` row. There is now
exactly one implementation of the guarded transition (`WalletRepository.markExported`), and no dead
`markExported`/`markWalletExported`.

## Technical Details
Affected: `wallet-export-repository.interface.ts` + `wallet-export.repository.ts` (finalize signature,
inline update removed), `wallet-export.service.ts` (both call sites pass `latchWallet`). The previously
unused `WalletsService.markWalletExported` / `WalletRepository.markExported` are now live.

## Acceptance Criteria
- [x] Exactly one implementation of the `active→exported` guarded transition remains.
- [x] The Wallet lifecycle flip routes through the wallets aggregate.
- [x] No dead `markExported`/`markWalletExported`.

## Work Log
- 2026-07-14: Filed from PR #25 review (architecture reviewer).
- 2026-07-15: Implemented Option A (latchWallet callback → markWalletExported). build + lint + 9 export e2e green. Marked complete.
