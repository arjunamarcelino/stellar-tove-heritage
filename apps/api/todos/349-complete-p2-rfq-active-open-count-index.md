---
status: complete
priority: p2
issue_id: 349
tags: [code-review, performance, database, tov-172]
dependencies: []
---
# `countActiveOpenByCollector` is not index-served — scans a collector's entire lifetime RFQ history (PR #46)

## Problem Statement
The per-collector active-open ceiling check (`RFQ_TOO_MANY_ACTIVE`) runs a `COUNT` on every create, filtering
`collector_sub = X AND status='open' AND deleted_at IS NULL`. The only usable index is
`UQ_rfqs_idem (collector_sub, idempotency_key_hash)` — its second column is the idem hash, **not** status —
so Postgres range-scans the leading `collector_sub` and heap-filters `status='open'`, reading **every RFQ
that collector has ever created**, not just the ≤25 open ones. RFQs are immutable and never deleted (the
guard trigger blocks DELETE and soft-delete); terminal `filled`/`canceled`/`expired` rows accumulate forever.
Cost grows with lifetime volume, on the synchronous create path, on every request.

The repo comment (`rfq.repository.ts:47`) and migration comment (`…041:62-63`) claim the count is "bounded by
the MAX_ACTIVE_OPEN_RFQS ceiling itself." **This is false** — only *open* rows are capped at 25; the scan
still traverses all historical rows for that collector.

## Findings
Source: performance-oracle (P2). Failure scenario: a collector with 5,000 historical RFQs (24 open) issues a
new RFQ → the abuse-control count scans ~5,000 index entries + heap-filters to find 24, synchronously, every request.

- `src/modules/marketplace/rfqs/repositories/rfq.repository.ts:45-51`
- `src/database/migrations/1716000000041-CreateRfqsTable.ts:62-69`

## Proposed Solutions
### Option A — Add a partial index matching the predicate; fix the misleading comment
- Description: New forward migration adds
  `CREATE INDEX "IDX_rfqs_active_open" ON "rfqs" ("collector_sub") WHERE "status" = 'open' AND "deleted_at" IS NULL;`
  making the count O(open) ≈ O(25) regardless of lifetime volume. Correct the "bounded by the ceiling" comment
  in the repo + migration.
- Pros: Fixes the actual cost; small, additive index; standard partial-index pattern.
- Cons: One more index to maintain on inserts (minor write amplification); a new migration.
- Effort: Small
- Risk: Low

### Option B — Just fix the comment, accept the scan
- Description: Leave the query, correct the false justification comment only.
- Pros: Zero schema change.
- Cons: Leaves an O(lifetime-volume) scan on the hot create path for heavy collectors.
- Effort: Small
- Risk: Low now, grows with data.

## Recommended Action
Option A — add the partial index; fix the comment. Approved 2026-08-21 (edited migration 041 in place, since it is unshipped in this PR).

## Resolution
Added `CREATE INDEX "IDX_rfqs_active_open" ON "rfqs" ("collector_sub") WHERE "status" = 'open' AND
"deleted_at" IS NULL` to migration 041 so the active-open ceiling COUNT is O(open) ≈ O(25) instead of
scanning the collector's entire lifetime RFQ history. Removed the false "bounded by the ceiling" claim from
the migration + repo comments (the repo comment fix shipped with #360). Added an integration drift-guard
asserting the index exists with the `status='open' AND deleted_at IS NULL` predicate. Verified: build 0,
integration 9/9, e2e 11/11 (test DB reset to re-apply the edited migration).

## Technical Details
- Affected: `rfq.repository.ts` (`countActiveOpenByCollector`), migration `…041` comments; a new migration `…042` for the index.
- Note: this interacts with todo #360 (the existing `IDX_rfqs_artwork` partial predicate is also a no-op given the soft-delete trigger).

## Acceptance Criteria
- [ ] `EXPLAIN` of the active-open count uses an index and does not scan all of a collector's rows.
- [ ] The false "bounded by the ceiling" comments are corrected.
- [ ] Integration test asserts the count is correct after the collector accrues terminal (non-open) RFQs.

## Work Log
- 2026-08-21 — Filed from PR #46 review (performance-oracle).

## Resources
- PR #46; `src/modules/marketplace/rfqs/repositories/rfq.repository.ts`; migration `1716000000041`.
