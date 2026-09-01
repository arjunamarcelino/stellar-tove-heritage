---
status: complete
priority: p2
issue_id: 105
tags: [code-review, reliability, concurrency, blockchain, relayer, TOV-21]
dependencies: []
---

# Relayer RPC calls are unbounded — LOCK_TTL can expire mid-critical-section; some send statuses mishandled

## Problem Statement
`LOCK_TTL_MS = 15000` is a hard `SET ... PX 15000 NX` expiry; the lock auto-releases at 15s whether
or not `buildAndSubmit` finished. `buildAndSubmit` makes three RPC calls (`getAccount`,
`prepareTransaction`, `sendTransaction`) with **no per-call timeout**. Under RPC latency their sum
can exceed 15s → the lock expires → a second request enters the critical section concurrently (this
compounds todo 104). The CAS release correctly no-ops for the stale holder, so no cross-holder
deletion, but mutual exclusion is already broken.

Separately, `sendTransaction` handles only `status === 'ERROR'`; `PENDING`, `DUPLICATE`, and
`TRY_AGAIN_LATER` fall through as if success. Under RPC rate-limiting, `TRY_AGAIN_LATER` is common —
the code returns `sent.hash` and then polls a hash that never appears, burning the full
`deployTimeoutMs` (up to 60s) before failing. The poll deadline is also only checked *between*
sleeps, so a single hung `getTransaction` is unbounded.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:28` (`LOCK_TTL_MS`), `:127-172` (unbounded RPCs in
  critical section), `:167-171` (only `ERROR` handled), `:174-189` (deadline checked between sleeps).
- `src/modules/relayer/redis-deploy-lock.ts:39` (PX TTL).

## Proposed Solutions

### Option A: Bound every RPC call + handle all send statuses (recommended)
Wrap each `this.server.*` call in a timeout (AbortController / `Promise.race`) with a ceiling well
under `LOCK_TTL_MS`; explicitly handle `TRY_AGAIN_LATER` (short retry) and `DUPLICATE` (treat as
already-submitted → poll). Size `LOCK_TTL_MS` from the now-bounded critical-section budget.
- **Effort:** Medium · **Risk:** Low

### Option B: Timeouts only
Just add the per-call timeouts (fixes the unbounded hang + TTL overrun) and leave send-status
handling for later.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**RESOLVED — Option A (bound every RPC call + handle all send statuses).**

## Resolution (2026-07-03)
- `src/modules/relayer/soroban-relayer.service.ts`:
  - Added `withTimeout(label, work)` (`Promise.race` vs a `RPC_TIMEOUT_MS = 5000` timer, clears on
    settle, swallows the losing promise's late rejection to avoid an unhandledRejection since the SDK
    call isn't cancellable). Wrapped all five RPC calls: `getAccount`, `prepareTransaction`,
    `sendTransaction`, `getTransaction` (both poll calls), `getLedgerEntries`.
  - Raised `LOCK_TTL_MS` 15s → **20s**, sized above the in-lock section (3 sequential RPCs ×
    5s = 15s < 20s), so a bounded critical section can no longer outlive the lock.
  - `sendTransaction` now switches on status: `PENDING`/`DUPLICATE` → poll the hash;
    `TRY_AGAIN_LATER` → `ThrottledError` (retried at the outer loop, no more silent 60s poll of a
    hash that never appears); `ERROR` → `SequenceError` (if txBadSeq) or a genuine failure.
  - Generalized the 104 retry to a `RetryableDeployError` supertype (`SequenceError` +
    `ThrottledError`); the outer loop retries both with a short backoff. Renamed
    `MAX_SEQ_RETRIES` → `MAX_DEPLOY_RETRIES`.
- `test/unit/modules/relayer/soroban-relayer.service.spec.ts`: added DUPLICATE-polls-hash,
  TRY_AGAIN_LATER-retries-then-succeeds, and a fake-timer "hung RPC times out" test.
- Verified: lint clean, `yarn build` 0 issues, relayer spec 15/15; full suites unit 252,
  integration 30 (+3 gated), e2e 60 — all green.

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts`.

## Acceptance Criteria
- [x] Each relayer RPC call has a bounded timeout (`RPC_TIMEOUT_MS`) < `LOCK_TTL_MS`.
- [x] `sendTransaction` `TRY_AGAIN_LATER`/`DUPLICATE` are handled explicitly (no silent max-timeout poll).

## Work Log
- 2026-07-03: Filed from the factory-deploy multi-agent review (performance-oracle).
- 2026-07-03: **Resolved** via Option A (RPC timeouts + send-status handling) — see Resolution. Committed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
- Related: todos 095, 104
