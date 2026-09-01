---
status: complete
priority: p3
issue_id: 312
tags: [code-review, money-safety, reliability, tov-158]
dependencies: []
---
# Cancel retry-budget self-heal is single-point-thin (only the final attempt lands past signature expiry)

## Problem Statement
A stuck `canceling` row self-heals only when a worker attempt reaches `submitSignedCancelBid`'s pre-lock expiry gate AFTER `BID_SIG_VALIDITY_LEDGERS` (~10 min), throwing `expired` → provably-no-refund → `casCancelFailedBackToEscrowed`. The retry budget (`attempts:10`, exponential `delay:2000` ≈ 17 min total) does outlast 10 min — but only attempt #10 is *guaranteed* past expiry. Attempts 1-9 can all legitimately return `unavailable` (poll-timeout, never-revert) while the signature is still valid. If that single post-expiry attempt's own `getLatestLedger` RPC throws a plain `Error` (blip), it is non-`RelayerTransferError` → not-provable → rethrow → attempts exhausted → row **stuck `canceling`** (frozen escrowed USDC + held slot), and there is no reconciler.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:~366` — `attempts: 10, backoff: { type:'exponential', delay:2000 }`.
- `src/modules/relayer/soroban-relayer.service.ts` — `BID_SIG_VALIDITY_LEDGERS = 120` (~600s); the expiry gate in `submitSignedCancelBid` (pre-lock).
- The arithmetic is CORRECT (the self-heal DOES fire in the happy case); the concern is margin, not magnitude.

## Proposed Solutions
### Option A — Widen the tail so 2-3 attempts land past expiry
- Description: `attempts: 12` (or a smaller base `delay`) so multiple attempts fire after the ~10-min window; a single RPC blip on the tail no longer strands the row.
- Pros: Cheap; makes the self-heal resilient to one bad RPC on the final attempt.
- Cons: A genuinely-doomed job retries a little longer before going to `failed` (still bounded; `concurrency:1` low volume).
- Effort: Small
- Risk: Low

### Option B — Add a bounded stuck-canceling sweeper (deferred reconciler)
- Description: A repeatable DB-only job that, for a `canceling` row past sig-expiry with no live BullMQ job, safely reverts to `escrowed`.
- Pros: Closes the stranding hole structurally, incl. the Redis-eviction case.
- Cons: This is the deferred reconciler (live-testnet-gated) the feature intentionally left out; larger scope.
- Effort: Medium
- Risk: Medium

## Recommended Action
Option A — widen the tail (attempts 10 → 12) so multiple attempts land past sig-expiry.

## Technical Details
Pairs with the monitoring alert in todo 310 (page on `canceling` > 15 min) — Option A reduces how often that alert fires from a tail RPC blip; Option B would let it auto-resolve.

## Acceptance Criteria
- At least 2 worker attempts are guaranteed to fire after `BID_SIG_VALIDITY_LEDGERS` before the job exhausts.
- (If Option B) a stuck `canceling` row past sig-expiry with no live job is auto-reverted to `escrowed`.

## Work Log
- 2026-08-20: created from PR #42 performance-oracle review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20)
Bumped the cancel enqueue `attempts` from 10 to 12 (exponential backoff, base 2s). The window is now
~68 min with ~3 attempts landing AFTER the ~10-min `BID_SIG_VALIDITY_LEDGERS` expiry, so a single RPC blip on
the first post-expiry attempt no longer strands the row — one of the later post-expiry attempts still reaches
the pre-lock expiry gate → `expired` (provably-no-refund) → `casCancelFailedBackToEscrowed` self-heal. The
stuck-canceling monitoring alert (todo 310) remains the backstop for the residual (all-attempts-consumed)
case. Deferred Option B (a bounded stuck-canceling sweeper / reconciler) as the larger live-testnet-gated
follow-up. Build clean; unit suite unaffected (attempts is a runtime enqueue opt).
