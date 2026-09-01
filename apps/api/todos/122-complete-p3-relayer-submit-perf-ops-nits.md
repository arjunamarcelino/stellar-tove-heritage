---
status: complete
priority: p3
issue_id: 122
tags: [code-review, performance, ops, relayer]
dependencies: []
---

# Relayer submit perf/ops nits: poll cadence, lock TTL, throughput ceiling, expiry TOCTOU, networkId memo

## Problem Statement
A cluster of small performance/operational tuning opportunities in the relayer submit + poll path.
None is a correctness issue; each trims wasted RPC calls, shortens worst-case stalls, or records an
operational limit that is currently implicit.

## Findings
1. **Poll cadence vs ledger close.** `pollForTransfer` polls every `POLL_INTERVAL_MS = 1000`
   (`soroban-relayer.service.ts:38`) against a ~5s ledger close. A first-poll delay (~2-3s) followed by
   1s cadence would cut ~4-5 wasted `getTransaction` calls per confirmation. Same applies to the deploy
   `pollForResult`.
2. **Submit lock TTL over-sized.** `SUBMIT_LOCK_TTL_MS = 20000` (~line 58) is ~4× the actual submit
   critical section (one bounded `sendTransaction` ≤5s + a CPU sign). Tighten toward ~8-10s to shorten
   the worst-case stall on the shared sequence; consider a bounded lock-acquisition timeout so queued
   submits fail fast rather than block.
3. **Throughput ceiling.** ~1 tx/ledger (one keypair = one sequence, cross-instance Redis lock). Record
   this as an explicit operational SLO limit; future mitigation = channel/fee-bump accounts or sequence
   pipelining.
4. **Expiry TOCTOU.** The expiry re-check (`~lines 274-278`) runs BEFORE the lock; under contention the
   send can occur ~1 ledger later than the check assumed. Optionally re-read `getLatestLedger` inside
   the lock before sign/send, or bump `EXPIRY_MARGIN_LEDGERS` (currently 2) to cover the lock window.
5. **networkId recompute.** `computeHostPayloadHash` recomputes `hash(networkPassphrase)` per call —
   memoize the networkId per passphrase (negligible; note only).

## Proposed Solutions
- Tune poll cadence (first-poll delay + 1s steady); right-size `SUBMIT_LOCK_TTL_MS` + add a bounded
  lock-wait; document the ~1 tx/ledger throughput ceiling; handle/note the expiry TOCTOU; memoize
  networkId. Each is independent.
- **Effort:** Small each · **Risk:** Low

## Recommended Action
**Resolved.** (1) `pollForTransfer` now waits `FIRST_POLL_DELAY_MS` (2s) before the first
`getTransaction` (a tx can't confirm before the next ledger close), skipping the guaranteed
NOT_FOUND calls. (2) `SUBMIT_LOCK_TTL_MS` tightened 20000 → 10000 (the submit critical section is one
`sendTransaction` + CPU sign; the Redis acquisition wait is bounded at 2× the TTL). (3) The ~1
tx/ledger throughput ceiling is documented as an SLO limit at the submit lock. (4) Expiry TOCTOU:
`EXPIRY_MARGIN_LEDGERS` bumped 2 → 4 to cover the lock-wait + send window. (5) `networkId =
sha256(passphrase)` memoized in `auth-entry-encoding.ts` (golden vector unchanged).

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts` — `POLL_INTERVAL_MS` (line 38),
  `EXPIRY_MARGIN_LEDGERS` (line 55), `SUBMIT_LOCK_TTL_MS` (line 58), `pollForTransfer` (~339),
  `pollForResult` (~414), expiry check (~274-278), lock (~314-332), `computeHostPayloadHash` usage
  (~227).

## Acceptance Criteria
- [x] Poll cadence tuned (first-poll delay on `pollForTransfer` reduces wasted `getTransaction` calls).
- [x] Submit lock TTL right-sized (10s); Redis acquisition wait bounded at 2× TTL.
- [x] The ~1 tx/ledger throughput ceiling documented as an operational limit (submit-lock comment).
- [x] Expiry TOCTOU handled via a margin bump (2 → 4 ledgers).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: first-poll delay, SUBMIT_LOCK_TTL 10s, EXPIRY_MARGIN 4, throughput-ceiling note,
  memoized networkId. Build + relayer tests (46) green (golden vector unchanged). *(pollForResult on
  the deploy path left as-is — out of TOV-22 scope.)*
