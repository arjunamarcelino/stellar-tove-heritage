---
status: complete
priority: p1
issue_id: 227
tags: [code-review, concurrency, performance, TOV-235, PR-33]
dependencies: []
---

# KYC allowlist lock TTL (30s) can expire mid-item under max config → concurrent-batch txBadSeq race

## Problem Statement
`submitOne` holds `KYC_ALLOWLIST_RELAYER_LOCK_KEY` across the full critical section (getAccount → build → simulate → send → **poll-to-closure**). The poll is deliberately inside the lock so the next item's `getAccount` observes the advanced sequence (cross-batch safety). But `LOCK_TTL_MS` is a fixed 30s while the worst-case in-lock hold can exceed 30s — reopening the exact `txBadSeq` collision the lock exists to prevent.

## Findings
- `src/modules/kyc-allowlist/kyc-allowlist.constants.ts:10` → `LOCK_TTL_MS = 30_000`.
- `src/config/validation-schema.ts:115` → `KYC_ALLOWLIST_SUBMIT_TIMEOUT_MS` `.max(30000)` (default 15000); consumed as the poll deadline in `soroban-kyc-allowlist.service.ts:pollToClosure`.
- Worst-case in-lock hold = getAccount(≤`RPC_TIMEOUT_MS` 5s) + simulate(≤5s) + send(≤5s) + poll(up to `submitTimeoutMs`, max 30s) + a trailing getTransaction(≤5s) ≈ up to ~50s. At the configured **max** `submitTimeoutMs=30000` the hold is guaranteed to exceed the 30s TTL; even at default 15s it can approach/exceed 30s.
- `src/modules/relayer/redis-relayer-account-lock.ts:37-56` sets a fixed PX TTL with NO renewal ("auto-expires at ttl"). If the TTL expires while `fn` still runs, a second concurrent admin batch sharing `KYC_ALLOWLIST_RELAYER_LOCK_KEY` can acquire the lock, `getAccount`, and build a tx on the **same sequence** the first holder already sent → txBadSeq. (Unlike TOV-233's fix in todo 215 — poll-outside-lock — this adapter must keep the poll inside the lock for cross-batch sequence closure, so the TTL must instead cover the whole hold.)

## Proposed Solutions
### Option A (recommended): derive LOCK_TTL_MS from submitTimeoutMs
- Compute `LOCK_TTL_MS = submitTimeoutMs + N*RPC_TIMEOUT_MS + margin` (≈ `submitTimeoutMs + 25_000`), so the TTL provably exceeds the max in-lock hold. Keep them coupled so they cannot drift. Effort: Small.

### Option B: lower the submitTimeoutMs ceiling
- Reduce the Joi `.max()` so `submitTimeoutMs + RPC timeouts` stays under a fixed 30s TTL. Effort: Small. Downside: caps per-item confirmation wait.

### Option C: lock renewal (heartbeat)
- Extend the lock PX on a timer while `fn` runs. Effort: Medium. Most robust but adds machinery to the shared lock.

## Recommended Action
**RESOLVED (Option A).** Replaced the hardcoded `LOCK_TTL_MS = 30_000` with `LOCK_TTL_BUFFER_MS = 25_000` (covers getAccount + simulate + send + trailing getTransaction, each ≤ RPC_TIMEOUT_MS 5s). `submitOne` now derives `lockTtl = cfg.submitTimeoutMs + LOCK_TTL_BUFFER_MS`, so the TTL always exceeds the worst-case in-lock hold (poll bound + non-poll RPCs) and the two can't drift. At max `submitTimeoutMs=30000` → TTL 55s > worst-case hold; at default 15000 → 40s.

## Technical Details
- Affected: `src/modules/kyc-allowlist/kyc-allowlist.constants.ts`, `src/modules/kyc-allowlist/soroban-kyc-allowlist.service.ts`, `src/config/kyc-allowlist.config.ts` / `validation-schema.ts`.

## Acceptance Criteria
- [x] `LOCK_TTL_MS` provably exceeds the worst-case in-lock hold at the max configured `submitTimeoutMs` (TTL = submitTimeoutMs + 25s buffer).
- [x] Two concurrent admin batches on the same account cannot build the same sequence (TTL now covers the full hold, so the lock can't expire mid-item).
- [x] TTL and `submitTimeoutMs` are coupled (derived) so they cannot drift.

## Work Log
- 2026-07-18: created from PR #33 review (performance-oracle P1).
- 2026-07-18: RESOLVED — derived lock TTL from `submitTimeoutMs + LOCK_TTL_BUFFER_MS`; build+lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- Related: todos/215 (TOV-233 lock-TTL, resolved via poll-outside-lock — not applicable here).
