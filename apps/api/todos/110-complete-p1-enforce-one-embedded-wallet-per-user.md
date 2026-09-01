---
status: complete
priority: p1
issue_id: 110
tags: [code-review, data-integrity, database, wallets, money]
dependencies: []
---

# One embedded-passkey wallet per user is a code assumption, not a DB constraint; findEmbeddedWalletByUserId is non-deterministic

## Problem Statement
`src/modules/wallets/repositories/wallet.repository.ts` (~lines 20-26) `findEmbeddedWalletByUserId`
uses `findOne({ where: { userId, kind: 'embedded_passkey' } })` with no `order` clause. The existing
unique indexes (migration `1716000000012`) enforce uniqueness per CONTRACT
(`UQ_wallets_contract_address_active`), NOT per user — there is no
`UNIQUE (user_id) WHERE kind = 'embedded_passkey' AND deleted_at IS NULL`. So "one live embedded
wallet per user" is an unenforced code assumption.

Today `createEmbeddedPasskeyWallet` binds only one, but a future add-second-passkey flow or a
soft-delete/recreate race could make this resolve a NON-DETERMINISTIC wallet for a money transfer
(the `from` address). Postgres `findOne` without `ORDER BY` can return different rows across calls,
so `/build` and `/submit` could resolve different wallets for the same user.

NOTE: the sibling `findByWalletId` (`passkey-credential.repository.ts`) IS safe —
`UQ_passkey_credentials_wallet_id_active` enforces its 1:1.

## Findings
- `findEmbeddedWalletByUserId` (lines 20-26) has no `order`; it relies solely on there being at most
  one matching live row, which the schema does not guarantee.
- Migration `1716000000012` provides `UQ_wallets_contract_address_active` (uniqueness per contract
  address), but no partial unique index keyed on `user_id` for `kind = 'embedded_passkey'`.
- Consequence: if two live embedded wallets ever exist for one user (future multi-passkey flow, or a
  soft-delete-then-recreate race), the resolved `from` wallet for a transfer is non-deterministic —
  and `/build` vs `/submit` may disagree on the same user's source wallet.
- Contrast: `PasskeyCredentialRepository.findByWalletId` is backed by
  `UQ_passkey_credentials_wallet_id_active`, so its 1:1 is enforced at the DB layer — the same
  guarantee is missing here.

## Proposed Solutions

### Option A: Add a partial unique index (the real fix)
- New migration adding `UNIQUE (user_id) WHERE kind = 'embedded_passkey' AND deleted_at IS NULL`,
  making the 1:1 an enforced invariant (mirrors the passkey-credential index).
- **Effort:** Medium · **Risk:** Low

### Option B: Interim — make the query deterministic + alert on anomaly
- Add `order: { createdAt: 'ASC' }` to `findEmbeddedWalletByUserId` so resolution is stable, and
  log/alert when more than one live embedded wallet is found for a user.
- Reduces the non-determinism symptom but does not enforce the invariant; best paired with Option A.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved via Option A + B (full fix).** New migration
`1716000000013-AddWalletsUserEmbeddedUniqueIndex` adds the partial unique index
`UQ_wallets_user_embedded_active` (`(user_id) WHERE kind='embedded_passkey' AND deleted_at IS NULL`),
making the 1:1 a DB-enforced invariant. `findEmbeddedWalletByUserId` now uses a deterministic
`ORDER BY created_at ASC` (via `find({ take: 2 })`) and warn-logs if >1 live embedded wallet is ever
found before returning the oldest.

## Technical Details
- Affected files:
  - `src/modules/wallets/repositories/wallet.repository.ts` (~lines 20-26, `findEmbeddedWalletByUserId`).
  - `src/database/migrations/1716000000012*` (existing per-contract unique index; new per-user
    partial unique index would live in a new migration alongside it).
  - Reference for the enforced-1:1 pattern: `passkey-credential.repository.ts` +
    `UQ_passkey_credentials_wallet_id_active`.

## Acceptance Criteria
- [x] The DB rejects inserting a 2nd live embedded-passkey wallet for the same user.
- [x] `findEmbeddedWalletByUserId` resolves deterministically (stable ordering, `created_at ASC`).
- [x] An anomaly (>1 live embedded wallet for a user) surfaces via a warn log.
- [x] Integration test covering the DB rejection (23505 on a 2nd live embedded wallet).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: added migration `1716000000013-AddWalletsUserEmbeddedUniqueIndex`
  (`UQ_wallets_user_embedded_active` partial unique index); made `findEmbeddedWalletByUserId`
  deterministic (`order created_at ASC`, `take: 2`) + warn on >1. Applied via `yarn db:test:setup`.
  Integration test asserts a 2nd live embedded wallet for one user → 23505. Build + integration (4
  tests) green. Marked complete.
