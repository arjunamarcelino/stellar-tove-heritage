---
status: complete
priority: p1
issue_id: 293
tags: [code-review, correctness, money, concurrency]
dependencies: []
---

# Escrow worker misclassifies post-send RPC timeouts as terminal → double-escrow risk

## Problem Statement
The bid escrow worker's retry gate is an allowlist of exactly ONE reason (`RelayerTransferError` with `reason === 'unavailable'`); everything else falls through to `casFailed` (terminal). But `withRpcTimeout` (`src/common/soroban/with-rpc-timeout.ts`) rejects with a PLAIN `Error`, not a `RelayerTransferError`. In `submitSignedBid`, both `sendTransaction` AND every `getTransaction` poll (`pollForBid`) are wrapped in `this.withTimeout(...)`. On this money surface, a timeout that fires AFTER the escrow tx has already been accepted/applied on-chain is misread as a terminal failure — the bid latches `failed`, frees the collector's active-bid slot, and opens a double-escrow window.

## Findings
- `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts:72-90` — catch clause: `if (err instanceof RelayerTransferError && err.reason === 'unavailable') throw err;` then everything else → `casFailed` + `UnrecoverableError`. Only ONE reason is treated as retryable.
- `src/modules/relayer/soroban-relayer.service.ts` — in `submitSignedBid` the `sendTransaction` call (~line 626) and the `pollForBid` `getTransaction` polls (~653/659) are `withTimeout`-wrapped; `withRpcTimeout` throws a plain `Error`, so a timeout there is NOT a `RelayerTransferError` and NOT `reason === 'unavailable'`.
- Failure scenario: `sendTransaction` returns PENDING (tx accepted by the network) but the HTTP round-trip exceeds `RPC_TIMEOUT_MS` (5s), OR a mid-poll `getTransaction` times out → a plain `Error` propagates → it is NOT `unavailable` → the catch runs `casFailed`, latching the bid `failed` and stopping retries. Seconds later the escrow tx APPLIES on-chain → `price × count` USDC is escrowed. The DB says `failed`, which FREES the `UQ_offering_bids_active_per_collector` slot → the collector can place a SECOND bid → DOUBLE ESCROW. `CHK_bid_unescrowed_clean` cannot catch this: the row legitimately has null escrow stamps.

## Proposed Solutions
### Option A: Adapter wraps ALL RPC timeouts as `RelayerTransferError('unavailable')`
- **Description:** Make `submitSignedBid`/`pollForBid` map any `withRpcTimeout` plain-Error rejection to `RelayerTransferError` with `reason === 'unavailable'`, so the port contract the worker relies on actually holds end-to-end.
- **Pros:** Minimal, localized to the adapter; keeps the processor's simple allowlist correct; fixes every call site at once. **Cons:** Relies on the adapter faithfully classifying every future timeout path. **Effort:** Small **Risk:** Low

### Option B: Invert the processor default (retry-by-default, terminate-by-allowlist)
- **Description:** Flip the processor so it only `casFailed`s on an allowlist of definitively-terminal PRE-send reasons (`signature_required | signature_invalid | expired | simulation_failed`); treat `unavailable`, any plain `Error`, and anything thrown AFTER `sendTransaction` returns a hash as retryable → rethrow for BullMQ backoff.
- **Pros:** Fail-safe posture on a money surface — ambiguous errors retry instead of latching `failed`; robust even if the adapter misclassifies. **Cons:** Larger change; must enumerate terminal reasons carefully; a truly-stuck job retries until max attempts. **Effort:** Medium **Risk:** Low

### Option C: Both A and B
- **Description:** Adapter maps timeouts to `unavailable` AND the processor inverts to terminate-by-allowlist, for defense in depth.
- **Pros:** Correct even if either layer regresses. **Cons:** Slightly more code/tests to maintain. **Effort:** Medium **Risk:** Low

## Recommended Action
<!-- filled during triage -->

## Technical Details
- `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts` (catch clause, lines 70-91)
- `src/modules/relayer/soroban-relayer.service.ts` (`submitSignedBid`, `pollForBid`, `withTimeout` usage)
- `src/common/soroban/with-rpc-timeout.ts` (plain-Error rejection)
- `src/modules/relayer/relayer.errors.ts` (`RelayerTransferError` shape)

## Acceptance Criteria
- [ ] A plain-Error timeout thrown from `sendTransaction` does NOT latch the bid `failed`.
- [ ] A plain-Error timeout thrown mid-`pollForBid` does NOT latch the bid `failed`.
- [ ] A unit test drives a non-`RelayerTransferError` throw through `process()` and asserts the row stays `submitted` (the error rethrows for BullMQ backoff rather than running `casFailed`).
- [ ] Reason classification (terminal vs retryable) is documented at the boundary so future reasons are triaged deliberately.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41
- src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts
- src/modules/relayer/soroban-relayer.service.ts
- src/common/soroban/with-rpc-timeout.ts
- src/modules/relayer/relayer.errors.ts

---

## Resolution (COMPLETE — 2026-08-20)

**Chosen:** money-safe conservative classification (confirmed with the maintainer).

`OfferingBidEscrowProcessor` now CAS-`failed`s a bid **only when the escrow provably moved no funds
on-chain**, via `isProvablyNoFundsMoved(err, firstAttempt)`:

- **Terminal (safe to fail, frees the slot):** `signature_required` / `signature_invalid` / `expired`
  (pre-send verification), `transfer_failed` (sent-but-rejected or applied-and-reverted → no state
  change), and `simulation_failed` **only on the first attempt** (`job.attemptsMade === 0` = pre-send
  re-simulation).
- **Retryable / ambiguous (rethrow, row stays `submitted`, slot NOT freed):** `unavailable`, any
  non-`RelayerTransferError` (a plain `Error` — e.g. an RPC timeout after `sendTransaction` was
  accepted), and `simulation_failed` on a **retry** (which may be the on-chain `DuplicateBid` from a
  first-attempt send that actually landed).

This **guarantees no double-escrow**: a bid whose funds may have moved is never wrongly failed. The
liveness cost — a bid whose confirmation was lost stays `submitted` until adopted — is the documented
manual/reconcile follow-up recorded in **todo 294**.

**Files:** `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts` (new
`isProvablyNoFundsMoved` helper + rewritten catch).
**Tests:** `test/unit/modules/offerings/offering-bid-escrow.processor.spec.ts` — added plain-Error
(rethrow, no casFailed), `transfer_failed` (fail), `simulation_failed` attempt-0 (fail) vs retry
(rethrow). 8/8 green; build green.
