---
status: complete
priority: p2
issue_id: 159
tags: [code-review, concurrency, data-integrity, wallets, tov-25, testing]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (prove-with-a-test); **no code change needed**. Added a `removeWallet auto-promote —
concurrency` block to `primary-wallet.integration.spec.ts` with three races:
1. delete-primary racing set-primary(other) → invariant holds, no raw 500;
2. delete-primary racing delete-sibling → invariant holds, refusals are `WalletMutationError` (never a 500);
3. double delete of the same primary → invariant holds, sibling ends up primary (callback may fire twice —
   a benign duplicate, documented).
Shared guards: `rejectionsAreDomainErrors` (no raw 500 leaks) and `assertInvariant` (≥1 live ⇒ exactly one
primary). Ran 3× — stable, all pass. **Conclusion: the data-integrity reviewer's suspected P1 (23505→500 on
the sibling promote) is refuted** — `runWithPrimaryContention` re-reads the target each attempt, so on retry a
concurrently-demoted target takes the non-primary branch and never re-collides. Option B (make removeWallet
demote the actual current primary) was therefore NOT needed.

# removeWallet auto-promote: prove the delete-vs-promote race with a test

## Problem Statement
`removeWallet`'s primary auto-promote path (`src/modules/wallets/wallets.service.ts:238-252`) demotes the
delete target, guard-promotes the oldest eligible sibling, then soft-deletes the target — all inside
`runWithPrimaryContention`. The **set-primary** races are covered by integration tests (set-vs-set,
set-vs-bind), but there is **no test** for `removeWallet(primary)` racing a concurrent `setPrimaryWallet`
or a concurrent `removeWallet(sibling)` on the same user. Two reviewers flagged this exact gap.

The data-integrity reviewer raised a potential P1: a concurrent actor promoting a *different* wallet to
primary could make the sibling-promote collide on `UQ_wallets_primary_active`, and asserted the single retry
can't clear it → a raw `23505` / HTTP 500. Independent analysis (TypeScript + performance reviewers, and the
author) argues the collision **cannot persist**, because `runWithPrimaryContention` re-runs the whole `fn`
each attempt: on attempt 2 the target `wallet` is re-read (`wallets.service.ts:226`), and if a concurrent tx
demoted it, the code takes the non-primary branch (plain soft-delete, no promote) — so no collision and no
500. This is **plausible but unproven**. A settlement-wallet invariant deserves a test, not an argument.

## Findings
- `wallets.service.ts:226` — `wallet` is re-read inside the retried `fn` each attempt (supports "no 500").
- `wallets.service.ts:242-246` — guarded sibling promote; `affected === 0` → `primary_cannot_be_removed`.
- `wallets.service.ts:392-411` — `runWithPrimaryContention` retries once only on `UQ_wallets_primary_active`.
- Existing coverage: `test/integration/modules/wallets/primary-wallet.integration.spec.ts` has set-vs-set and
  set-vs-bind, but no delete-vs-promote / delete-vs-delete race.
- Secondary edge: a concurrent **double `DELETE` of the same primary** can, if both txs read the target as
  primary before either commits, produce a spurious second `PRIMARY_CHANGED (auto_promote)` audit row and a
  no-op re-promote (invariant still holds, but audit noise).

## Proposed Solutions
### Option A (recommended): Add concurrency regression tests, keep code as-is if they pass
- Add to the primary-wallet integration spec: (1) `removeWallet(P)` concurrent with `setPrimaryWallet(T)`
  where T ≠ sibling; assert exactly one live primary, target deleted or refused cleanly, **no 500**.
  (2) `removeWallet(P)` concurrent with `removeWallet(S)` (the sibling); assert one live primary or clean
  `primary_cannot_be_removed`. (3) double `removeWallet(P)`; assert invariant + document audit-row count.
- **Pros:** proves the reasoning; no risk from touching correct code; documents the concurrency contract.
- **Cons:** if a test reveals a real 500, escalates to a code fix (see Option B). **Effort: Small.**

### Option B: If a test fails — make removeWallet demote the *actual* current primary
- Re-read `{ userId, isPrimary: true }` and demote that row (as `setPrimaryWallet` does) instead of assuming
  the target is still the primary; or treat a primary-index `23505` as "another primary already exists →
  skip promote, just soft-delete the target."
- **Pros:** removes any residual ambiguity. **Cons:** only warranted if Option A shows a real defect.
  **Effort: Small–Medium.**

## Recommended Action
_(triage)_

## Technical Details
- Files: `src/modules/wallets/wallets.service.ts` (226, 238-252, 392-411);
  `test/integration/modules/wallets/primary-wallet.integration.spec.ts`.
- No schema change. Also document (code comment) why `removeWallet`/`setPrimaryWallet` ignore the helper's
  `allowPrimary` arg while bind/reactivate use it (see #164).

## Acceptance Criteria
- [ ] Integration test: `removeWallet(primary)` racing `setPrimaryWallet(other)` → exactly one live primary, no 500.
- [ ] Integration test: `removeWallet(primary)` racing `removeWallet(sibling)` → one live primary or clean 409.
- [ ] Double `removeWallet(primary)` behavior asserted (invariant holds; audit-row count documented).
- [ ] If any test fails, apply Option B and re-run.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27. Data-integrity flagged possible 500; TS + perf
  analysis argue the per-attempt re-read prevents it. Resolve by proving with a test rather than a blind fix.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
- Plan: `docs/plans/2026-07-15-feat-primary-settlement-wallet-endpoint-plan.md`
