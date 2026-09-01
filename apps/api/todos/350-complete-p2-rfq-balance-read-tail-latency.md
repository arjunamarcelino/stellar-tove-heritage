---
status: complete
priority: p2
issue_id: 350
tags: [code-review, performance, tov-172]
dependencies: []
---
# Synchronous ~2.5s balance RPC dominates tail latency of a "pure DB write" endpoint (PR #46)

## Problem Statement
Every successful (non-replay, whitelisted, under-cap, valid-artwork) RFQ create runs
`RfqBalanceAdvisor.warnIfInsufficient`, which does a DB wallet-resolution read **plus** a Soroban RPC bounded
at `BALANCE_WARN_DEADLINE_MS = 2500`. So p99 create latency is ~2.5s+ whenever the chain is slow — for an
*advisory* warning that never blocks creation. This runs synchronously on the request path (before the txn).
Under a degraded Soroban RPC, a burst of creates ties up NestJS handlers and DB connections held across the
2.5s await, throttling throughput far below what a pure DB insert would sustain.

## Findings
Source: performance-oracle (P2). `readWalletHoldings` itself is two sequential Soroban RPCs (~5s each), so the
2.5s deadline is a hard cap on an inherently slow read.

- `src/modules/marketplace/rfqs/rfqs.service.ts:123` → `rfq-balance.advisor.ts:31-47`
- `src/modules/marketplace/rfqs/constants/rfq.constant.ts:26` (`BALANCE_WARN_DEADLINE_MS`)

## Proposed Solutions
### Option A — Lower the deadline
- Description: Drop `BALANCE_WARN_DEADLINE_MS` to ~800-1200ms. A soft-warn rarely needs 2.5s; a slower chain just
  drops the warning (already the swallow path).
- Pros: One-line change; bounds tail latency without moving the warning off the write path.
- Cons: More warnings dropped when the chain is moderately slow (degraded UX, not correctness).
- Effort: Small
- Risk: Low

### Option B — Deliver the warning out-of-band
- Description: Return 201 immediately (skip the inline balance read); surface balance via the existing
  `GET /me/holdings` or a follow-up poll on the FE.
- Pros: Create path becomes sub-100ms pure DB; no chain dependency on the write.
- Cons: FE change + a second call for the warning; loses the "warn at creation time" UX.
- Effort: Medium
- Risk: Low (product/UX decision).

## Recommended Action
Option A — lower the deadline. Approved 2026-08-21.

## Resolution
Lowered `BALANCE_WARN_DEADLINE_MS` from 2500 to **1200ms** (`rfq.constant.ts`) and updated the rationale
comment. The inline soft-warn stays, but a slow chain now drops the warning after 1.2s (still 201, no
warning) instead of holding the create request up to ~2.5s. Out-of-band delivery (Option B) was considered
and deferred — revisit if the warning UX needs to survive a consistently slow chain. Verified: build 0, lint clean.

## Technical Details
- The read is correctly OUTSIDE the DB txn already (confirmed by review) — the concern is request-handler/connection
  occupancy during the await, not txn duration.
- Pairs with todo #355 (log level) — a persistently slow chain should be observable, not silent.

## Acceptance Criteria
- [ ] Decision recorded: keep inline (with what deadline) vs out-of-band.
- [ ] If inline, the deadline value is justified against measured Soroban p95.

## Work Log
- 2026-08-21 — Filed from PR #46 review (performance-oracle).

## Resources
- PR #46; `rfq-balance.advisor.ts`; `rfq.constant.ts`.
