---
status: complete
priority: p1
issue_id: 212
tags: [code-review, reliability, soroban, data-integrity, TOV-233, PR-32]
dependencies: []
---

# tokenOf() self-heal read needs a funded relayer account; unfunded/RPC failure is misclassified terminal → spurious artwork revert

## Problem Statement
`tokenOf()` builds its simulation transaction from `server.getAccount(relayer.publicKey())`, which
throws if the relayer account doesn't exist on-chain (unfunded/fresh env/rotated key). Because
`tokenOf` runs on every deploy attempt and reconcile row, and the deploy processor classifies a generic
Error as TERMINAL, a transient/operational condition reverts the artwork even though nothing was
attempted on-chain.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` `tokenOf` (~line 73) builds its simulate tx from `server.getAccount(this.relayer.publicKey())`, which THROWS if the account doesn't exist on-chain (unfunded/fresh env/rotated key).
- `tokenOf` runs on every deploy attempt/retry (self-heal precheck ~line 97) and every reconcile row.
- In the deploy processor (`fraction-deploy.processor.ts` ~lines 83-92), a generic `Error` is classified TERMINAL → `latchFailed` + reverts artwork to `verified` even though nothing was attempted on-chain and the condition is transient/operational.

## Proposed Solutions
### Option A (recommended): treat registry-read account/RPC failures as retryable + add boot probe
- A registry read (`token_of`) doesn't need the relayer's ledger entry — catch getAccount-not-found / RPC-availability failures in the self-heal path and treat as RETRYABLE (throw a transient error subclass so BullMQ retries), never terminal.
- Add a boot probe asserting the relayer account exists + funded (pairs with todo 211).

**Effort: Medium.**

## Recommended Action
**RESOLVED (Option A).** `tokenOf` now wraps the `getAccount` + `simulateTransaction` reads in a try/catch and rethrows ANY failure (unfunded/nonexistent relayer account, RPC timeout, simulation-unavailable) as a `FractionThrottledError` — a RETRYABLE class. On the deploy path this propagates through `deployFractionToken`'s self-heal to the worker, which already treats `FractionThrottledError`/`FractionSequenceError` as transient (BullMQ retry, row stays `deploying`) instead of misclassifying it as terminal and reverting the artwork to `verified`. A genuine `None` (token not deployed) still returns `null`. The paired relayer-account-exists boot probe lands with todo 211. (The reconcile loop's per-row guard so one bad read doesn't abort the batch lands with todo 216.)

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (`tokenOf`, ~lines 73, 97); `src/modules/fractionalization/deploy/fraction-deploy.processor.ts` (~lines 83-92).

## Acceptance Criteria
- [ ] `tokenOf`/self-heal getAccount-not-found and RPC-availability failures are classified RETRYABLE, not TERMINAL.
- [ ] A transient error subclass triggers BullMQ retry rather than `latchFailed`/artwork revert.
- [ ] A boot probe asserts the relayer account exists and is funded.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — token_of failures are now retryable, never terminal; build green.
