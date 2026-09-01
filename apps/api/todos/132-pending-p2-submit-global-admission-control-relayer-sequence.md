---
status: pending
priority: p2
issue_id: 132
tags: [code-review, performance, reliability, export, TOV-40]
dependencies: []
---

# Per-user submit throttle is decoupled from the global ~0.2 TPS relayer-sequence ceiling

## Problem Statement
`submitSignedTransfer` serializes every send through one relayer sequence via `RELAYER_ACCOUNT_LOCK`; the code itself documents the cap at ~1 tx/ledger-close (~0.2 TPS) system-wide. But the export submit throttle is per-user (10/min). These two numbers are unrelated: a handful of users each within their per-user budget already exceeds ~0.2 TPS, so requests queue on the Redis lock (acquisition wait bounded ~20s) and then surface as lock-timeout / `TRY_AGAIN_LATER` → 503 to users whose requests were within their own rate budget. One submit of N items also occupies ≥ N × ~5–7s wall-clock (each item: lock → send → poll). There is no global admission control matching the real backend throughput.

## Findings
- `src/modules/wallets/export/wallet-export.controller.ts:38` — submit `@Throttle` 10/min (per user).
- `src/modules/relayer/soroban-relayer.service.ts:445-448` — single shared sequence ~0.2 TPS note.
- `wallet-export.service.ts:197-247` — sequential per-item loop with per-item poll.

## Proposed Solutions

### Option A: Move submission to the existing BullMQ jobs infra (enqueue + poll status)
- **Description:** HTTP submit enqueues; a worker drains at ≤1 tx/ledger with backpressure; the client polls `GET .../export/status`. Aligns with the reconciliation endpoint that already exists.
- **Pros:** Real backpressure at the true throughput; decouples HTTP from ledger latency; robust under concurrency.
- **Cons:** Larger change; submit becomes async (FE already has a `pending`/`submitting` status to poll).
- **Effort:** Large
- **Risk:** Medium

### Option B: Global concurrency semaphore for the money-send path
- **Description:** A backend-wide semaphore/queue sized to the relayer's real throughput, independent of the per-user throttle.
- **Pros:** Smaller than a full queue; caps fleet-wide contention.
- **Cons:** Still synchronous HTTP; users wait or get 503 under load.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
**DEFERRED (2026-07-15, confirmed with the owner).** Not fixed in the PR #25 review pass. The BullMQ
option makes submit asynchronous, which would break the synchronous submit contract the web app (TOV-23)
just built against; the semaphore option is Medium effort and still 503s under load. The relayer already
degrades to a bounded-wait 503 (`TRY_AGAIN_LATER`/lock timeout) under contention, so there is a safe
backstop today. This needs product/FE coordination on the async-submit + polling model (the `status`
endpoint already exists for it) and belongs in a dedicated effort, not a quiet review fix. Kept `pending`.

## Technical Details

## Technical Details
Affected: submit path + relayer lock. Consider channel/fee-bump accounts (noted in `soroban-relayer.service.ts`) to raise the ceiling. Until fixed, document that 10/min per-user does NOT protect the shared sequence.

## Acceptance Criteria
- [ ] Concurrent exports across users degrade gracefully (queue/backpressure), not a 503 cliff at modest concurrency.
- [ ] Backend admission control is matched to the real relayer throughput.

## Work Log
- 2026-07-14: Filed from PR #25 review (performance reviewer).
- 2026-07-15: DEFERRED — async-submit changes the FE contract; needs product/FE coordination. Left pending.
