---
status: complete
priority: p2
issue_id: 215
tags: [code-review, performance, concurrency, TOV-233, PR-32]
dependencies: []
---

# Deploy lock TTL (20s) < worst-case locked work (~40s incl. 20s poll) → stale-sequence collisions

## Problem Statement
The Soroban fraction deploy holds the relayer lock for the full build-sign-submit-poll cycle, but the lock TTL is shorter than the worst-case duration of that cycle. The TTL can expire mid-poll, letting a concurrent transfer/deploy acquire the lock and build on a stale sequence number — the exact collision the lock exists to prevent.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` ~line 35 sets `LOCK_TTL_MS = 20_000`.
- The work inside `withLock` (`buildAdminSignAndSubmit`) = getAccount + simulate + getLatestLedger + sendTransaction (each ≤5s) + `pollForResult` bounded by `deployTimeoutMs` (default `20_000`). Worst case ~40s inside a 20s-TTL lock.
- TTL can expire while polling, letting a concurrent transfer/deploy acquire the lock and build on a stale sequence → `txBAD_SEQ` (surfaces as a retryable `FractionSequenceError`, self-corrects, but is exactly the collision the lock prevents; worsens under bulk-fractionalize bursts sharing `FRACTION_RELAYER_LOCK_KEY`).
- The sequence number is consumed at `sendTransaction`, not during poll → the poll does not need the lock at all.

## Proposed Solutions
### Option A (recommended): release the lock after send, poll outside it
- Hold the lock only through `sendTransaction`, then release and run `pollForResult` OUTSIDE the lock.
- Closes the TTL gap AND ~halves lock contention for slow deploys (the ~20s poll no longer occupies the lock).
- **Effort:** Medium.

### Option B: raise and derive LOCK_TTL_MS
- Raise `LOCK_TTL_MS` to exceed getAccount + simulate + getLatestLedger + send + `deployTimeoutMs` (≥45-60s) and derive it from `deployTimeoutMs` so the two cannot drift.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A — higher-value fix).** Split `buildAdminSignAndSubmit` into `buildSignAndSend` (lock-protected: getAccount → simulate → authorize → assemble → sign → send, returns the tx hash) and moved `pollForResult` OUTSIDE the `withLock` in `deployFractionToken`. The relayer-account lock now covers only the ~4 bounded RPCs of the sequence-consuming critical section (comfortably < LOCK_TTL_MS=20s), and the deploy-timeout poll loop no longer holds the lock — closing the TTL-vs-poll gap and roughly halving lock contention for slow deploys (admin bursts no longer starve user transfers during the poll). LOCK_TTL_MS stays 20s (now correct for the send-only section, not the poll).

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (~line 35 `LOCK_TTL_MS`, `withLock`/`buildAdminSignAndSubmit`, `pollForResult`).
- Sequence is consumed at `sendTransaction`; the poll only observes the result, so it is safe outside the lock.

## Acceptance Criteria
- [ ] Lock is not held during `pollForResult`, OR `LOCK_TTL_MS` provably exceeds the worst-case in-lock duration.
- [ ] If Option B, `LOCK_TTL_MS` is derived from `deployTimeoutMs` so they cannot drift.
- [ ] No path can hold the lock for longer than its TTL under bulk-fractionalize bursts.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — poll moved outside the lock; critical section is now send-only; build green.
