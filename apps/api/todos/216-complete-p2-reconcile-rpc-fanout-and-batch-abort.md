---
status: complete
priority: p2
issue_id: 216
tags: [code-review, performance, reliability, TOV-233, PR-32]
dependencies: []
---

# Reconcile tick does N sequential tokenOf RPC reads (up to ~200s) vs 60s cron; one row's RPC failure aborts the whole batch

## Problem Statement
The reconcile processor reads on-chain state for each pending row sequentially, so a full batch can overrun the cron period; and a single row's RPC throw aborts the loop mid-batch, blocking promotion of every other row in the batch.

## Findings
- `src/modules/fractionalization/deploy/fraction-reconcile.processor.ts` ~lines 44-70 loops sequentially, each `tokenOf` doing getAccount + simulate (2 RPCs, each ≤5s).
- With `reconcileBatch = 20`, worst case ~200s against `*/1 * * * *`. `concurrency: 1` serializes execution per worker (no parallel ticks), but a routinely-overrunning tick backs up the scheduled reconcile queue → delays crash-window recovery.
- A single `tokenOf` throw (see todo 212) aborts the loop mid-batch, blocking promotion of the other 19.

## Proposed Solutions
### Option A (recommended): bounded-parallel reads + per-row isolation
- Bounded-parallel the per-row `tokenOf` reads (`Promise.all` over chunks of 4-5; the reads are independent).
- Keep CAS writes sequential.
- Wrap each row's `tokenOf` in try/catch so one bad row / RPC blip does not abort the batch.
- Ensure `reconcileBatch × 2 × RPC_TIMEOUT` stays under the cron period.
- **Effort:** Medium.

## Recommended Action
**RESOLVED (Option A).** The reconcile tick now resolves `token_of` for all stale rows with BOUNDED parallelism (chunks of 5 independent reads) instead of N sequential reads — cutting a full 20-row tick from ~200s toward ~40s, comfortably under the 60s cron. Each read is wrapped in try/catch so a single failing/transient `token_of` (now a retryable throttle per todo 212) logs a warning and skips that row rather than aborting the whole batch. The CAS promotions stay sequential (cheap DB writes, keeps the single-writer story simple).

## Technical Details
- Affected: `src/modules/fractionalization/deploy/fraction-reconcile.processor.ts` (~lines 44-70).
- Each `tokenOf` is getAccount + simulate (2 RPCs). Reads are independent → safe to parallelize; only CAS writes must stay ordered.

## Acceptance Criteria
- [ ] Per-row `tokenOf` reads run bounded-parallel (chunk size 4-5), CAS writes stay sequential.
- [ ] A single row's `tokenOf` failure does not abort the batch (per-row try/catch).
- [ ] Worst-case tick duration (`reconcileBatch × 2 × RPC_TIMEOUT`) is under the cron period.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — bounded-parallel reads + per-row isolation; build green.
