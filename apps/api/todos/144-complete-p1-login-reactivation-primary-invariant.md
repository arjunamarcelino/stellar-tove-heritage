---
status: complete
priority: p1
issue_id: 144
tags: [code-review, data-integrity, wallets, TOV-24]
dependencies: []
---

# `findOrCreateForWallet` (login) reactivation doesn't recompute `is_primary` — can 500 a login / break the one-primary invariant

## Problem Statement
TOV-24 added the invariant "≥1 live wallet ⇒ exactly one primary" and `bindByowWalletToUser` upholds it on
reactivation (recomputes `is_primary`, handles the `primary` 23505, runs in a tx). The **login** sibling
`findOrCreateForWallet` restores a soft-deleted wallet via `walletRepo.restore()` (`repository.recover()`)
**without recomputing `is_primary`**, with **no `primary`-constraint 23505 handling**, and **outside any
transaction** (the SEP-10 challenge was already consumed before this call). This asymmetry is a latent
integrity trap on a critical path.

## Findings
- `src/modules/wallets/wallets.service.ts` — `findOrCreateForWallet`, reactivation branch (~L65–70):
  `const wallet = await this.walletRepo.restore(softDeleted); return …` — no `is_primary` recompute.
  The catch (~L83–92) only re-reads on the **public_key** unique violation; a `primary` collision falls
  through and **500s the login**.
- Contrast `bindByowWalletToUser` (same file), which recomputes `isPrimary = (liveCount === 0)` in-tx and
  demote-retries on the `primary` 23505.
- Related asymmetry: `createEmbeddedPasskeyWallet` unconditionally sets `isPrimary: true` with no
  `primary`-23505 handling (safe today only because the passkey user is created in the same tx with zero
  prior wallets — an unguarded invariant).
- Reported by the data-integrity reviewer as the one item to block on.

**Reachability note (for triage):** through the current API alone, a *primary* byow wallet cannot be
soft-deleted (`removeWallet` blocks primary; export uses `removed_at`/`status`, not `deleted_at`), so the
duplicate-primary 500 needs a non-API/admin/data path or FR-01.04 to create a `is_primary=true` +
`deleted_at IS NOT NULL` row. The common reactivation case (soft-deleted **non-primary** wallet) is already
correct. Severity is P1 because it's an unguarded invariant on the login hot path with a cheap fix, not
because it's trivially reachable today.

## Proposed Solutions

### Option A: Mirror `bindByowWalletToUser` normalization in the login reactivation path (recommended)
Before `recover()`, in a transaction, compute `isPrimary = (live count for user === 0)`, set it on the
entity (clearing the stale flag), and add the same demote-and-retry-once on a `primary` 23505.
- **Pros:** Removes the asymmetry; login can't 500 or corrupt the invariant; one consistent reactivation rule.
- **Cons:** Adds a tx + count to the login path (already cheap, single-user).
- **Effort:** Small · **Risk:** Low

### Option B: Minimal — only extend the catch to handle the `primary` constraint (demote + retry)
Leave the happy path, but stop the 500 by catching the `primary` 23505 and retrying with `is_primary=false`.
- **Pros:** Smallest change; prevents the login crash.
- **Cons:** Doesn't fix the zero/stale-primary correctness case; still divergent from the bind path.
- **Effort:** Small · **Risk:** Low

### Option C: Extract a shared `reactivateWalletForUser(manager, row)` helper used by both paths
- **Pros:** Single source of truth for reactivation + primary normalization.
- **Cons:** Slightly more refactoring; touches the audited login path.
- **Effort:** Medium · **Risk:** Low–Medium

## Recommended Action
Option A (shared, transactional reactivation helper), plus a discovered fix: use a single atomic UPDATE
instead of `recover()`.

## Implemented Solution
Root cause was deeper than the switch asymmetry: **`repository.recover()` only clears `deleted_at`** (it's a
dedicated `SoftDeleteQueryBuilder` restore) — it does **not** persist the `is_primary`/`status` field
changes set on the entity beforehand. So *both* reactivation paths could resurrect a frozen
`is_primary=true` and collide with a live primary. (An added integration test reproduced the 23505.)

Fix (`src/modules/wallets/wallets.service.ts`):
- New private `reactivateRow(manager, wallet, isPrimary)` — a **single UPDATE** that clears `deleted_at` and
  sets `is_primary`/`status`/`removed_at` together, so a stale flag can never transiently collide. Mutates
  the in-memory entity to match.
- New private `reactivateWalletForUser(userId, wallet)` — transactional, demote-and-retry-once on a `primary`
  23505; used by the login path (`findOrCreateForWallet`).
- Primary is now computed as **`!hasLivePrimary`** (`count WHERE is_primary AND live > 0`) in both the bind
  and login reactivation paths — self-healing: a reactivated wallet becomes primary iff the user currently
  has no live primary, restoring "≥1 live ⇒ exactly one primary" regardless of how the row was soft-deleted.
- `bindByowWalletToUser` reactivation switched from `recover()` to `reactivateRow` (fixes the same latent
  `recover()` bug) and from `liveCount === 0` to `!hasLivePrimary`.
- `createEmbeddedPasskeyWallet`'s `isPrimary: true` retained + documented as invariant-safe (a brand-new
  passkey user has zero prior wallets in the same tx).

Tests: added `wallets.service.integration.spec.ts` "reactivation recomputes is_primary on login
(no duplicate-primary 500) [TOV-24 #144]"; updated the bind reactivation test to the API-realistic
soft-delete-the-secondary case. Full suite green (317 unit / 53 integration / 85 e2e).

## Technical Details
Affected: `src/modules/wallets/wallets.service.ts` (`findOrCreateForWallet`, `bindByowWalletToUser`,
`reactivateWalletForUser`, `reactivateRow`, `createEmbeddedPasskeyWallet`).
Invariant enforced by `UQ_wallets_primary_active` (migration `1716000000020`).

## Acceptance Criteria
- [x] Login reactivation of a soft-deleted wallet recomputes `is_primary` (never resurrects a stale `true`).
- [x] A `primary` 23505 on login reactivation is handled (no 500) via demote-retry, matching the bind path.
- [x] `createEmbeddedPasskeyWallet`'s unconditional `isPrimary: true` documented as invariant-safe.
- [x] Integration test: reactivating a soft-deleted `is_primary=true` row while another live primary exists
      does not 500 and leaves exactly one live primary.

## Work Log
- 2026-07-15: Filed from PR #26 multi-agent review (data-integrity P1; corroborated by the security pass
  noting the bind path is the only one that normalizes).
- 2026-07-15: Fixed. Discovered `recover()` doesn't persist non-delete fields → switched both paths to an
  atomic `reactivateRow` UPDATE + `!hasLivePrimary` self-healing primary computation. Tests added; suite green.
