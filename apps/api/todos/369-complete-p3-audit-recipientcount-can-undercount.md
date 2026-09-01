---
status: complete
priority: p3
issue_id: 369
tags: [code-review, correctness, tov-174, pr-47]
dependencies: []
---
# Audit `recipientCount` can disagree with the actual notification-row count under concurrent divergent winners (PR #47)

## Problem Statement
The fan-out audit row records `recipientCount = winnerSubs.length` from the CAS **winner's** pre-transaction
resolution. If two workers ever process the same `rfqId` concurrently with *different* resolved winner sets
(a new winner appeared between the two resolutions), the CAS **loser** still commits its
`insertManyIgnoreConflicts` before returning, so a recipient only the loser resolved gets a real row — while
the winner's audit records the smaller count. The audit trail then undercounts the rows that exist.

## Findings
Source: data-integrity-guardian (LOW). Largely theoretical: `jobId=rfqId` normally prevents concurrent
same-RFQ processing, but the code's own comments lean on the CAS/ordering (not BullMQ dedup) as the
correctness guarantee, so the invariant is worth making exact. This is **not** a corruption risk —
notifications remain a correct superset; only the audit `recipientCount` can be stale.
- `src/modules/marketplace/notifications/fanout/rfq-fanout.service.ts:53-68` (loser commits its insert at :56
  before returning; `recipientCount` from `winnerSubs.length` at :64).

## Proposed Solutions
### Option A — Derive `recipientCount` from the actual observed rows (Recommended if exactness matters)
- Description: In the winning branch, count the rows that exist for the RFQ (e.g. a `SELECT count(*)` inside
  the txn, or consume the insert's real inserted count across both workers) rather than the pre-txn
  `winnerSubs.length`.
- Pros: Audit count always matches reality.
- Cons: An extra read inside the txn; marginal.
- Effort: Small · Risk: Low
### Option B — Accept + document
- Description: Note that `recipientCount` is the resolving worker's view; the notification rows are the source
  of truth. Given `jobId=rfqId` makes concurrent same-RFQ runs rare, this is acceptable.
- Pros: Zero change.
- Cons: Audit can undercount in the rare race.
- Effort: None · Risk: None

## Recommended Action
Option A — derive `recipientCount` from the actual committed rows.

## Resolution (2026-08-21, complete)
Added `IRfqNotificationRepository.countForRfq(manager, rfqId)` (a `count(*)` scoped to the RFQ within the
caller's txn). `RfqFanoutService.fanout` now, after winning the CAS latch, stamps the audit `recipientCount`
from `countForRfq(manager, rfqId)` — the exact rows that exist for the RFQ — instead of the pre-txn
`winnerSubs.length`. So the audit count can no longer under-count if a concurrent worker inserted a divergent
set. Files: `rfq-notification-repository.interface.ts`, `rfq-notification.repository.ts`, `rfq-fanout.service.ts`.
Tests: fan-out service unit mock gains `countForRfq`; integration asserts `payload->>'recipientCount' == 3`.
Unit 5 / integration 8 green; tsc + lint clean.

## Acceptance Criteria
- [ ] Either `recipientCount` reflects the actual row count, or the semantic ("resolving worker's view") is documented.

## Work Log
- 2026-08-21: Filed from PR #47 review (data-integrity-guardian, LOW).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
