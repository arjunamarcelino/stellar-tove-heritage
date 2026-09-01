---
status: complete
priority: p2
issue_id: 285
tags: [code-review, TOV-154, PR-39, concurrency, soroban]
dependencies: []
---

# Escrow Redis lock TTL is undersized vs. real worst-case hold — multi-instance double-deploy risk (txBadSeq)

## Problem Statement
In `soroban-offering-escrow.service.ts`, `LOCK_TTL = deployTimeoutMs(20s) + pollTimeoutMs(30s) +
LOCK_TTL_BUFFER_MS(5s) = 55s`, but the **actual worst-case in-lock hold is ~56s**:

- Pre-poll 4 awaited RPCs × `RPC_TIMEOUT_MS(5s)` = 20s, then
- `pollToClosure` can overshoot `pollTimeoutMs` by ~6s: it checks the deadline, sleeps
  `POLL_INTERVAL_MS(1s)`, then issues one more `getTransaction` up to 5s (`RPC_TIMEOUT_MS`) past the
  deadline.

So the 5s buffer is fully consumed (or negative under Redis/CPU jitter). Note that `deployTimeoutMs` is used
**only** in the TTL arithmetic and never bounds an actual call (the RPCs use the hardcoded
`RPC_TIMEOUT_MS`).

In a multi-instance deployment the single shared `OFFERING_ESCROW_LOCK_KEY` serializes **all** offerings'
deploys onto the one admin source account. If the Redis lock expires mid-poll, a second instance acquires
it and builds a transaction on the **same sequence number** → `txBadSeq` churn — exactly what the lock
exists to prevent. (The processor's `lockDuration: 90_000` already covers the true hold; only the Redis
lock TTL is under-sized.)

## Findings
- **performance-oracle (P2):** the TTL formula understates the real hold by ~1s at nominal timings and goes
  negative under jitter, so the serialization guarantee on the shared admin source account is not durable
  across instances. Evidence: `soroban-offering-escrow.service.ts:33-36` (`deployTimeoutMs`, `pollTimeoutMs`,
  `LOCK_TTL_BUFFER_MS`, `LOCK_TTL` constants), `:92` (lock acquisition/TTL), `:200-211` (`pollToClosure`
  deadline check → sleep → one more `getTransaction`).

## Proposed Solutions
### Option A — Derive the TTL from real bounds [recommended]
Set `LOCK_TTL ≈ 4*RPC_TIMEOUT_MS + (pollTimeoutMs + POLL_INTERVAL_MS + RPC_TIMEOUT_MS) + margin`, and raise
`LOCK_TTL_BUFFER_MS` to `≥ POLL_INTERVAL_MS + RPC_TIMEOUT_MS` (~6s) plus safety (~15s).
- **Pros:** TTL provably exceeds the worst-case hold with a documented margin. **Cons:** longer lock hold
  slightly reduces cross-offering deploy throughput on the shared account. **Effort:** Small. **Risk:** Low.

### Option B — Bound pollToClosure to the deadline
Stop issuing a new `getTransaction` once `deadline - RPC_TIMEOUT_MS` is passed, so the poll can never
overshoot into the buffer.
- **Pros:** removes the overshoot at the source rather than padding the TTL. **Cons:** may abandon a poll a
  beat early; still want a margin. **Effort:** Small. **Risk:** Low-Medium.

## Recommended Action
Do **Option A** (derive the TTL with an explicit, documented margin); optionally add Option B to cap the
poll overshoot. Relatedly, `OFFERING_ESCROW_DEPLOY_TIMEOUT_MS` is otherwise unused — see the simplification
todo.

## Technical Details
- `src/modules/offerings/soroban-offering-escrow.service.ts` (lines 33-36, 92, 200-211)

## Acceptance Criteria
- [x] Worst-case in-lock hold is provably `< LOCK_TTL` with a documented margin.
- [x] Single-source-account serialization holds across multiple instances (no lock expiry mid-poll → no
      second acquirer building on the same sequence).

## Resolution (2026-08-20 — Option A)
`soroban-offering-escrow.service.ts`: LOCK_TTL is now DERIVED from the real bounds instead of the config knob:
`lockTtl = PRE_POLL_RPC_COUNT(4)*RPC_TIMEOUT_MS(5s) + pollTimeoutMs(30s) + POLL_INTERVAL_MS(1s) + RPC_TIMEOUT_MS(5s) + LOCK_TTL_MARGIN_MS(15s)` ≈ **71s** vs the worst-case hold ~56s — a ~15s margin (was ~0/negative). The `POLL_INTERVAL_MS + RPC_TIMEOUT_MS` term explicitly covers the one poll-overshoot iteration. The processor `lockDuration: 90_000` comfortably exceeds 71s.

Also **removed the now-dead `OFFERING_ESCROW_DEPLOY_TIMEOUT_MS` knob** (it bounded no real call — RPCs use the fixed `RPC_TIMEOUT_MS`; it only padded the old TTL). Dropped from `offering-escrow.config.ts`, `validation-schema.ts`, `.env`, `.env.example` (this also closes the config-knob item listed in todo 291). Build + lint green; config spec (knob-gone) passes.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review.
- 2026-08-20 — Resolved (Option A). Derived TTL from real bounds + 15s margin; removed the unused deploy-timeout knob.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
