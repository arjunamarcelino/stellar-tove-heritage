---
status: complete
priority: p3
issue_id: 164
tags: [code-review, maintainability, wallets, tov-25, quality]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (all four fixes):
1. Exported `PrimaryChangeResult` + `PrimaryReassignment` from `wallets.service.ts`; `setPrimaryWallet`/
   `removeWallet` signatures and the unit + integration tests now use them (no more re-declared shapes).
2. Idempotent no-op passes `previousWalletId: null` (was `target.id`); updated the unit + integration
   assertions accordingly.
3. Documented the `allowPrimary` divergence on `setPrimaryWallet` and in the `runWithPrimaryContention`
   CONTRACT block.
4. `runWithPrimaryContention` doc now states `fn` MUST re-read each attempt AND its callbacks must stay
   CHEAP (single in-tx write; no HTTP/queue/extra-query I/O) because wallet row locks are held until commit.
Tests green (unit 18, integration 13).

# Clarity cleanup around the primary-contention code + callbacks

## Problem Statement
Several small maintainability items cluster around `setPrimaryWallet`/`removeWallet`/`runWithPrimaryContention`
and the audit callbacks. None affect behavior, but together they invite future misreadings (and one already
forced test-side type duplication).

## Findings
1. **`allowPrimary` divergence undocumented** — `setPrimaryWallet` (`wallets.service.ts:176`) and
   `removeWallet` (`:224`) ignore the helper's `allowPrimary` arg (they rely on re-read + demote-first +
   guarded promote), while `bindByowWalletToUser`/`reactivateWalletForUser` use it. A reader comparing them
   reasonably suspects a forgotten parameter. The helper's "fn MUST re-read each attempt" contract
   (`:388`) is load-bearing but enforced only by convention.
2. **Callback payload shapes duplicated across prod/test** — the inline `{changed, previousWalletId}` and
   `{previousWalletId, newWalletId}` types (`wallets.service.ts:171-174`, `219-222`) are re-declared in the
   unit spec as `SetPrimaryOnChange`/`RemoveOnReassigned` to stay lint-safe. They should be exported named
   types (e.g. `PrimaryChangeResult`, `PrimaryReassignment`) so prod and test can't drift.
3. **Misleading no-op arg** — the idempotent no-op passes `previousWalletId: target.id`
   (`wallets.service.ts:183`), which the me-surface discards (`changed:false` returns early). It's not a
   "previous"; pass `null` (matching the changed-branch convention) or comment.
4. **In-tx callbacks must stay cheap** — `onChange`/`onPrimaryReassigned` run inside the swap tx while primary
   row locks are held. Today each does one audit INSERT. A future callback doing I/O (HTTP, queue, extra
   query) would extend the lock-hold window. Add a contract comment so nobody adds I/O there.

## Proposed Solutions
### Option A (recommended): Apply the four small clarity fixes
- Export named callback-payload types and use them in prod + tests; pass `null` for the no-op previous id;
  add doc comments on the `allowPrimary` divergence, the "must re-read" contract, and "callbacks must stay
  cheap (locks held)".
- **Pros:** removes prod/test drift and the traps; no behavior change. **Cons:** touches several files.
  **Effort: Small.**

### Option B: Do nothing
- **Pros:** none. **Cons:** the traps persist. **Effort: None.**

## Recommended Action
_(triage)_

## Technical Details
- Files: `src/modules/wallets/wallets.service.ts` (171-197, 219-252, 388-411),
  `src/modules/wallets/me/me-wallets.service.ts`, `test/unit/modules/wallets/me-wallets.service.spec.ts`,
  `test/integration/modules/wallets/primary-wallet.integration.spec.ts`.

## Acceptance Criteria
- [ ] Named callback-payload types exported and imported by tests (no re-declaration).
- [ ] No-op passes `null` for `previousWalletId` (or is commented).
- [ ] Comments document the `allowPrimary` divergence, the re-read contract, and cheap-callback requirement.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (typescript + performance + simplicity + data-integrity
  all touched these). Bundled as one clarity pass.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
