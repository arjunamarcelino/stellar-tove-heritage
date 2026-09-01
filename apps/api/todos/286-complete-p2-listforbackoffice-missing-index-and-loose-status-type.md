---
status: complete
priority: p2
issue_id: 286
tags: [code-review, TOV-154, PR-39, performance, typescript]
dependencies: []
---

# listForBackoffice: unindexed status+created_at scan on a growing table + loose `readonly string[]` status param

## Problem Statement
Two related issues in the backoffice offerings list path:

1. **Missing index.** `offering.repository.ts` `listForBackoffice` runs
   `WHERE status IN (...) AND deleted_at IS NULL ORDER BY created_at DESC` plus a `COUNT(*)`, with **no
   supporting index**. The only offerings indexes are `UQ_offerings_active_per_artwork(artwork_id, ...)`
   and `IDX_off_approved_open_due(window_open_at, status='approved')`. Both the page query and the count
   seq-scan the full `offerings` table (which grows unbounded — terminal settled/canceled rows are never
   removed) and do a top-N sort. This backs the admin approval work-queue the UI polls. Migration 032's own
   note deferred this index to "the FR that first adds an offerings list" — **TOV-154 is that FR.**

2. **Loose status type.** The finder's `statuses: readonly string[]` param
   (`offering-repository.interface.ts:59-64`) throws away the `OfferingStatus` union, forcing
   `In([...statuses] as OfferingStatus[])` (`offering.repository.ts:128`) — a cast that re-narrows
   unverified data and lets a bad status value pass the compiler.

## Findings
- **performance-oracle (P2, index):** the list + count are zero-index reads on a table that only grows, so
  cost climbs with total offerings created, not just active ones. Evidence: `offering.repository.ts`
  `listForBackoffice` query; existing indexes `UQ_offerings_active_per_artwork` and
  `IDX_off_approved_open_due`; migration 032 deferral note.
- **kieran-typescript-reviewer (P2, type):** `readonly string[]` discards the `OfferingStatus` union and
  is patched with an `as OfferingStatus[]` cast. Evidence: `offering-repository.interface.ts:59-64`;
  `offering.repository.ts:128` (`In([...statuses] as OfferingStatus[])`). The sibling `ArtworkRepository`
  already types its equivalent param with the union.

## Proposed Solutions
### Index
- **Option A [recommended]:** partial index
  `CREATE INDEX IDX_offerings_list_created ON offerings (created_at DESC) WHERE deleted_at IS NULL` — serves
  the default active work-queue and the count with an index scan.
  - **Pros:** small, covers the common path. **Cons:** doesn't cover a status-narrowed sort specifically.
    **Effort:** Small. **Risk:** Low.
- **Option B:** composite `(status, created_at DESC) WHERE deleted_at IS NULL` if the status-narrowed
  variant needs covering.
  - **Pros:** covers `status IN (...)` + ordered page. **Cons:** larger index; only worth it if status
    filtering is hot. **Effort:** Small. **Risk:** Low.

### Type
- **Option A [recommended]:** tighten the param to `readonly OfferingStatus[]` in both the interface and the
  impl and drop the `as OfferingStatus[]` cast (match the `ArtworkRepository` sibling).
  - **Pros:** compiler enforces valid statuses; removes an unsound cast. **Cons:** none. **Effort:** Small.
    **Risk:** Low.

## Recommended Action
Add the partial index (index Option A) via a new migration and tighten the param to
`readonly OfferingStatus[]` (type Option A), dropping the cast. Low urgency at today's volume, but it is a
genuine zero-index read on a table that only grows, and the type fix is free.

## Technical Details
- `src/modules/offerings/offering.repository.ts` (`listForBackoffice` query; line 128 cast)
- `src/modules/offerings/offering-repository.interface.ts` (lines 59-64)
- `src/database/migrations/` (migration 032 deferral note; new index migration)

## Acceptance Criteria
- [x] A supporting index exists for the list filter+sort (composite partial), drift-guarded in integration.
- [x] The `statuses` param is typed `readonly OfferingStatus[]` in interface + impl, with no
      `as OfferingStatus[]` cast.

## Resolution (2026-08-20)
- **Index:** new migration `1716000000035-AddOfferingsListIndex` → `CREATE INDEX IDX_offerings_list ON
  offerings (status, created_at DESC) WHERE deleted_at IS NULL`. The `status` prefix serves the COUNT + the
  status-narrowed queue; `created_at DESC` provides the sort. Applied to `tove_test`. Integration drift-guard
  added (asserts status + `created_at DESC` + `deleted_at IS NULL` in `pg_indexes`).
- **Type:** `listForBackoffice`'s `statuses` param tightened `readonly string[]` → `readonly OfferingStatus[]`
  in the interface + impl; dropped the `In([...statuses] as OfferingStatus[])` cast (now `In([...statuses])`).
  `parseStatuses` already returns `readonly OfferingStatus[]`, so the call site type-checks with no cast.
- Build + lint + offerings integration (15) green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review.
- 2026-08-20 — Resolved. Migration 035 composite partial index + drift-guard; tightened statuses type (no cast).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
