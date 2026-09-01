---
status: complete
priority: p2
issue_id: 371
tags: [code-review, consistency, architecture, tov-175, pr-48]
dependencies: []
---
# Audit-kind value `marketplace.quote.submitted` is inconsistent with its marketplace siblings (PR #48)

## Problem Statement
The new audit kind uses a `marketplace.` namespace prefix that no other marketplace kind uses. These are
persisted strings in `internal_audit_log`; vocabulary drift is expensive (and append-only-guarded) to correct
once rows exist, so it should be decided **before the first production write**.

## Findings
Source: architecture-strategist (P2).
- `src/modules/wallets/audit/audit-log.types.ts:52` — `QUOTE_SUBMITTED: 'marketplace.quote.submitted'`.
- Siblings in the same domain are bare-resource-prefixed: `RFQ_CREATED: 'rfq.created'` (line 46),
  `RFQ_NOTIFICATIONS_FANNED_OUT: 'rfq.notifications.fanned_out'` (line 49).
- (Note: the `QUOTE_*` **error codes** got the namespacing right — this is only the audit-kind value.)

## Proposed Solutions
### Option A — Rename to `quote.submitted` (Recommended)
- Matches the bare-resource style of `rfq.created`.
- Pros: consistent, shortest. Cons: none (pre-prod).
- Effort: Small · Risk: Low
### Option B — Rename to `rfq.quote.submitted`
- Signals a quote is a sub-resource of an RFQ.
- Pros: encodes the parent relationship. Cons: slightly longer; no sibling uses a 3-segment kind yet.
- Effort: Small · Risk: Low

## Recommended Action
Option A (`quote.submitted`) unless the team prefers to encode the RFQ parentage (Option B). Decide before any
prod `internal_audit_log` row is written.

## Resolution (2026-08-22, complete — Option A)
Renamed `AUDIT_KIND.QUOTE_SUBMITTED` value `marketplace.quote.submitted` → **`quote.submitted`** to match the
bare-resource style of `rfq.created`/`rfq.notifications.fanned_out`. Updated the unit assertion in
`quotes.service.spec.ts`. No prod rows exist yet, so no data migration needed. Build 0; quote unit 26 green.
(The historical plan doc still cites the old value as originally planned — left as the record.)

## Technical Details
- Single-line change in `audit-log.types.ts`; update the unit test assertion in
  `test/unit/modules/marketplace/quotes.service.spec.ts:134` (`kind: 'marketplace.quote.submitted'`).

## Acceptance Criteria
- [x] The audit-kind value follows the marketplace naming convention (matches `rfq.created`).
- [x] Unit test assertion updated; no other references to the old string.

## Work Log
- 2026-08-22: Filed from PR #48 review (architecture-strategist P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
