---
status: complete
priority: p1
issue_id: 308
tags: [code-review, money-safety, concurrency, correctness, tov-158]
dependencies: []
---
# `cancel()` reverts a LIVE refund job when `idempotency.complete()` fails post-enqueue (double-refund / state-drift window)

## Problem Statement
In `OfferingBidsService.cancel()`, the post-commit block wraps BOTH `cancelQueue.add(...)` (which makes the refund job live) AND `idempotency.complete(...)` in a single `try`, whose `catch` unconditionally reverts `canceling → escrowed`. If the enqueue **succeeds** but `complete()` **throws** (a Redis blip — the same failure mode that also lets the worker run), the compensation reverts a bid whose refund job is already in flight. This is exactly the "revert after the refund may have landed" move the feature's own money-safety design forbids (`offering-bid-cancel.processor.ts:71-74`, "ambiguity must NEVER revert"). Three independent review agents (security, TypeScript, architecture) converged on this defect.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:360-379` — `cancelQueue.add` (361) and `idempotency.complete` (373) share one `try`; the `catch` (374-378) runs `casCancelFailedBackToEscrowed` + `idempotency.fail` + throws 503.
- **Failure scenario:** enqueue succeeds → the `concurrency:1` worker reads `status='canceling'`, acquires the relayer lock, and begins the on-chain refund send/poll (seconds). Concurrently `complete()` throws → the catch CAS-reverts the row to `escrowed` (wins, row still `canceling`) and returns 503. The refund then lands on-chain, but the worker's `casCanceled` (WHERE `status='canceling'`) matches 0 rows → no-op. Result: **USDC refunded on-chain while the DB shows `escrowed`** with the active slot held. The bid can never reach `canceled`; `GET :id/bids/me` shows it stuck `escrowed`; a re-cancel issues a fresh `cancel_bid` that the escrow contract rejects (already canceled). Actual fund duplication is blocked ONLY by the on-chain single-cancel guard (see todo 311) — absent that, this is a P1 double-spend; with it, it is severe state-drift requiring manual reconciliation plus a wrong 503 to the user.
- **Secondary nit (same block):** `casCancelFailedBackToEscrowed` is `await`ed directly inside the `catch`; if that DB call itself throws, the raw error propagates and `idempotency.fail` + the 503 `throw` never run.

## Proposed Solutions
### Option A — Scope the compensating revert to enqueue failure only; make `complete()` best-effort (mirror `submit()`)
- Description: Move `idempotency.complete()` OUT of the enqueue `try`. Compensate (revert + `idempotency.fail` + 503) only when `cancelQueue.add` itself rejects (the only state where the job is provably not live). After a successful enqueue, run `complete()` in its own best-effort `.catch(log)` that never reverts. Matches the submit path (`offering-bids.service.ts:217-235`).
- Pros: Eliminates the revert-after-live race; consistent with the audited submit flow; a client retry after a `complete()` failure safely sees `BID_NOT_CANCELABLE` (409, bid is `canceling`) instead of a revert.
- Cons: On a `complete()` failure the idempotency key is left `in_flight` until it self-expires (acceptable — the enqueued job drives the row to `canceled` and the client polls `GET :id/bids/me`).
- Effort: Small
- Risk: Low

### Option B — Keep the structure but guard the revert on "enqueue not yet acknowledged"
- Description: Track whether `add()` resolved; in the catch, only revert if it did not. Wrap the revert itself in try/catch.
- Pros: Smaller diff.
- Cons: More conditional state to reason about; still couples two Redis ops in one try; strictly worse than Option A which the codebase already models.
- Effort: Small
- Risk: Medium (easy to get the flag ordering wrong)

## Recommended Action
Option A — scope the compensating revert to enqueue failure only; make `complete()` best-effort.

## Technical Details
Affected: `src/modules/offerings/bids/offering-bids.service.ts` (cancel enqueue/compensation, ~lines 355-380). The submit path at lines 213-232 is the reference pattern (enqueue is best-effort, `complete()` outside the fail-guard, no revert on post-commit failure). The revert `casCancelFailedBackToEscrowed` should also be hardened with its own best-effort wrapper so a DB error can't swallow the 503.

## Acceptance Criteria
- `idempotency.complete()` is outside the enqueue `try`; a `complete()` failure never triggers `casCancelFailedBackToEscrowed`.
- The compensating revert fires ONLY when `cancelQueue.add` rejects.
- A unit test asserts: enqueue succeeds + `complete()` throws → row stays `canceling`, no revert CAS called, no 503 from that path.
- Existing cancel enqueue-failure test still passes (revert + fail + 503 when `add` rejects).

## Work Log
- 2026-08-20: created from PR #42 multi-agent review (security + kieran-typescript + architecture agents independently flagged)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42
- Reference pattern: `submit()` enqueue-then-complete in the same file
- Related: todo 311 (on-chain single-cancel guard is the last-line defense this relies on)

---

## Resolution (COMPLETE — 2026-08-20)
Applied Option A in `OfferingBidsService.cancel()`: the compensating revert
(`casCancelFailedBackToEscrowed` + `idempotency.fail` + 503) is now scoped to a `cancelQueue.add` failure
ONLY — the one state where the refund job provably never became live. `idempotency.complete()` moved OUT of
the enqueue `try` into its own best-effort `.catch(log)` that never reverts, so a post-enqueue Redis blip can
no longer revert a live/landed refund (eliminating the double-refund / DB-chain drift window). The revert CAS
is now wrapped in its own try/catch so a DB error can't swallow the 503. On a `complete()` failure the key
self-expires and a client retry safely sees `BID_NOT_CANCELABLE` (bid is `canceling`).

Regression test added (`offering-bids.service.spec.ts`): `add()` succeeds + `complete()` throws → returns 202
`canceling`, and asserts `casCancelFailedBackToEscrowed` and `idempotency.fail` are NOT called. Existing
enqueue-failure test (add rejects → revert + fail + 503) still passes. Service unit 32/32, build 0 issues.

Contract note (bounds the pre-fix severity): the escrow contract's own test `cancel_inactive_bid_reverts_bid_inactive`
(src/test.rs:320) proves a 2nd `cancel_bid` reverts with `BidInactive` and moves no funds — so even pre-fix
this was DB-chain state-drift, not an on-chain double-spend (see todo 311). The fix removes the drift.
