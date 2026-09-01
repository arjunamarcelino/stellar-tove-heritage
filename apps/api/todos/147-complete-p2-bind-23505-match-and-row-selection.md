---
status: complete
priority: p2
issue_id: 147
tags: [code-review, correctness, concurrency, wallets, TOV-24]
dependencies: []
---

# `bindByowWalletToUser`: fragile constraint-name matching + arbitrary row selection when a pubkey has live+soft-deleted rows

## Problem Statement
Two related robustness gaps in the bind race-resolution logic:

1. **Constraint-name substring matching.** The 23505 recovery branches on `constraint.includes('primary')`
   and `constraint.includes('public_key')`. If neither substring matches (empty `err.constraint`, or a
   future/other unique violation), the code falls through both `if`s and **re-throws the raw
   `QueryFailedError`** — a 500 for what may be a legitimate concurrent race. Also, a `public_key` collision
   whose winning row is soft-deleted or null falls through to `throw err` (raw 23505) instead of a clean
   domain error.

2. **Arbitrary row selection.** `UQ_wallets_public_key_active` is partial (`WHERE deleted_at IS NULL`), so
   multiple soft-deleted rows for the same pubkey can coexist with at most one live row. The in-tx
   `repo.findOne({ where: { publicKey }, withDeleted: true })` has **no ordering**, so with several rows
   sharing the pubkey Postgres returns an arbitrary one. Ownership/primary decisions then lean on the 23505
   fallback firing rather than a deterministic read.

Currently self-heals via the demote/retry + winner re-read, but correctness shouldn't depend on the fallback.

## Findings
- `src/modules/wallets/wallets.service.ts` — `bindByowWalletToUser`: the in-tx `findOne` (no `order`), and
  the `catch` branches on `constraintName(err).includes('primary' | 'public_key')` with a terminal
  `throw err`.
- `constraintName()` returns `''` when absent → both `includes` are false → raw rethrow.
- Security + data-integrity reviewers (P2).

## Proposed Solutions

### Option A: Exact index-name match + deterministic live-first read + terminal domain error (recommended)
- Match on the exact index names (`'UQ_wallets_primary_active'`, `'UQ_wallets_public_key_active'`).
- Read the **live** row first (`withDeleted: false`) to establish current ownership; consult soft-deleted
  rows only for the same-owner reactivate branch (or add explicit `order` to disambiguate).
- Add a terminal branch mapping an unrecognized-but-expected pubkey race to `already_bound` rather than a
  raw 23505.
- **Pros:** Deterministic; no 500 on a legit race; ownership decision doesn't rely on arbitrary rows.
- **Cons:** Slightly more query logic in the hot path.
- **Effort:** Small–Medium · **Risk:** Low

### Option B: Serialize per-user with `pg_advisory_xact_lock(hashtext(userId))` at the top of the tx
- **Pros:** Removes the concurrent-first-add primary race entirely; simpler catch.
- **Cons:** Extra lock per bind; doesn't by itself fix the arbitrary-row read.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (exact index-name match + deterministic live-first read + terminal domain error).

## Implemented Solution
`src/modules/wallets/wallets.service.ts`, `bindByowWalletToUser`:
- **Deterministic ownership resolution.** Replaced the single unordered
  `findOne({ publicKey, withDeleted: true })` with two userId-scoped reads: (1) any row (live or
  soft-deleted) owned by `Not(userId)` → sticky `already_bound` 409; (2) the caller's own row (live →
  idempotent no-op; soft-deleted → reactivate). No decision depends on an arbitrary row when several rows
  share the pubkey. (Incidentally dropped the unused `user` join here — see [[148]].)
- **Exact index-name matching.** The 23505 catch now matches `constraint === 'UQ_wallets_primary_active'`
  and `=== 'UQ_wallets_public_key_active'` (was fragile `.includes(...)`).
- **No raw 500 on a legit race.** A `public_key` collision resolves via `findByPublicKey`: our own
  concurrent add returns the winner; anyone else's (or a since-removed winner) maps to `already_bound`
  rather than rethrowing the raw `QueryFailedError`.

Verified by the existing sticky-identity + already-bound integration tests; full suite green
(317 unit / 26 wallets-integration / 85 e2e).

## Technical Details
Affected: `src/modules/wallets/wallets.service.ts` (`bindByowWalletToUser`). Uses `Not` from typeorm. Partial
indexes `UQ_wallets_public_key_active` / `UQ_wallets_primary_active`.

## Acceptance Criteria
- [x] A pubkey race that isn't a recognized constraint no longer surfaces a raw 500 (public_key race → domain error).
- [x] Ownership/primary decisions are deterministic when live + soft-deleted rows share a pubkey (userId-scoped reads).
- [x] Integration coverage: foreign soft-deleted row → sticky 409; foreign live → 409; own soft-deleted → reactivate.

## Work Log
- 2026-07-15: Filed from PR #26 review (security + data-integrity, P2).
- 2026-07-15: Fixed — deterministic userId-scoped reads + exact index-name matching + terminal `already_bound`
  on the public_key race. Suite green.
