---
status: complete
priority: p2
issue_id: 317
tags: [code-review, reliability, tov-160]
dependencies: []
---
# `close_offering` `OfferingNotOpen` revert is classified terminal, wedging the losing double-enqueued settle job

## Problem Statement
In the `close_offering` on-chain path, `onSimError` throws `OfferingSettleContractError` (`retryable: false`) for **any** revert, including `OfferingNotOpen`. Under a multi-instance deployment combined with the stale-subscribed reconcile double-enqueue (jobId is `settle:${id}:${uuid}` with no BullMQ dedupe), two settle jobs can run concurrently. Instance A closes the offering (`open → closed`); instance B then simulates `close_offering`, gets `OfferingNotOpen`, treats it as terminal, stamps `settle_failed_at`, and writes a spurious `OFFERING_SETTLE_FAILED` audit while A is legitimately settling. Because `findStaleSubscribed` excludes rows with `settle_failed_at IS NOT NULL`, if A then crashes between its on-chain `close_and_settle` landing and its `persist()` commit, the row is wedged `subscribed` + failure-stamped and excluded from auto-reconcile — forcing a manual admin re-drive despite money having already moved.

## Findings
- `src/modules/offerings/escrow/soroban-offering-escrow.service.ts` — the `close_offering` `onSimError` handler throws `OfferingSettleContractError` (`retryable: false`) for every revert, with no discrimination of the contract error code.
- `parseContractErrorCode(err)` is already defined in the same service but is currently **unused** (dead code). It can map the revert to the contract error code so `OfferingNotOpen` (contract code `1`) is handled distinctly.
- `src/modules/offerings/repositories/offering.repository.ts` — `findStaleSubscribed` excludes `settle_failed_at IS NOT NULL`, so a failure-stamped subscribed row is invisible to auto-reconcile.
- **Race window:** settle jobId is `settle:${id}:${uuid}` (no dedupe), so the stale-subscribed reconcile can enqueue a second settle job that runs on another instance concurrently with the original.

## Proposed Solutions
### Option A — Use `parseContractErrorCode` to make `OfferingNotOpen` retryable
- Description: In the `close_offering` `onSimError`, call `parseContractErrorCode(err)` and, when it resolves to `OfferingNotOpen` (contract code `1`), throw `OfferingEscrowThrottledError` (retryable) instead of `OfferingSettleContractError`. The losing job then re-reads `readStatus` on retry and adopts/no-ops the already-closed offering rather than terminalizing it. All other revert codes stay terminal.
- Pros: Fixes the wedge on the money path; the losing double-enqueued job self-heals via `readStatus` adoption. Also resolves the separate "`parseContractErrorCode` is dead code" simplicity/typescript finding by putting it to its intended use.
- Cons: Slightly more branching in the error handler; relies on the contract code mapping being correct.
- Effort: Small
- Risk: Low

### Option B — Deduplicate settle jobs at enqueue time
- Description: Give the settle job a stable jobId (e.g. `settle:${id}`) so BullMQ dedupes concurrent enqueues, preventing the second job from ever running.
- Pros: Removes the concurrency at the source rather than tolerating it.
- Cons: Does not fix the general case where two instances legitimately contend (e.g. after a job expires/retries); leaves `OfferingNotOpen` misclassified for any other path that hits it; larger behavioral change to the queue semantics.
- Effort: Small
- Risk: Medium

## Recommended Action
Option A — in the `close_offering` `onSimError`, use `parseContractErrorCode(err)` to treat `OfferingNotOpen` (contract code `1`) as retryable (`OfferingEscrowThrottledError`) so the losing job re-reads `readStatus` and adopts/no-ops. This also resolves the dead-code finding for `parseContractErrorCode` — the fix is to **use** it here, not delete it.

## Technical Details
`parseContractErrorCode` already exists in `soroban-offering-escrow.service.ts`; wire it into the `close_offering` `onSimError`. Contract error code `1` corresponds to `OfferingNotOpen`. The retryable throw must be a type the settle processor's classifier treats as retryable (`OfferingEscrowThrottledError`) so the attempt is retried and `readStatus` re-read adopts the closed state. Keep all other revert codes mapped to the terminal `OfferingSettleContractError`.

## Acceptance Criteria
- A `close_offering` simulation that reverts with `OfferingNotOpen` (code `1`) is classified retryable and does **not** stamp `settle_failed_at` or emit `OFFERING_SETTLE_FAILED`.
- On retry, the losing job re-reads `readStatus`, observes the already-closed offering, and adopts/no-ops.
- All other `close_offering` revert codes remain terminal (`OfferingSettleContractError`).
- `parseContractErrorCode` is referenced (no longer dead code).

## Work Log
- 2026-08-20: created from PR #43 [security-sentinel] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
`closeOffering`'s `onSimError` now branches on `parseContractErrorCode(err)`: a `#1` (`OfferingNotOpen`)
revert is re-thrown as a **retryable** `OfferingEscrowThrottledError` instead of a terminal
`OfferingSettleContractError`. So when a benign duplicate/concurrent settle job loses the close race
(instance A already moved `open → closed`), instance B backs off and its next self-heal-first `readStatus`
observes `Closed`/`Settled` and adopts — rather than stamping a spurious terminal `settle_failed_at` that
would exclude the row from `findStaleSubscribed` and wedge auto-recovery. Any other revert stays terminal.
Added the `CONTRACT_ERR_OFFERING_NOT_OPEN = 1` named constant. Side effect: this makes the previously-unused
`parseContractErrorCode` load-bearing, resolving the "dead code" nit raised in #336/simplicity. Build green.
