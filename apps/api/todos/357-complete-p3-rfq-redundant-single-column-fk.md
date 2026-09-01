---
status: complete
priority: p3
issue_id: 357
tags: [code-review, data-integrity, performance, tov-172]
dependencies: []
---
# Single-column `FK_rfqs_artwork` is redundant with the composite FK — a second parent lock per insert (PR #46)

## Problem Statement
Migration `1716000000041` declares both `FK_rfqs_artwork (artwork_id) → artworks(id)` AND the composite
`FK_rfqs_artwork_fc (artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id)`. The composite FK
already guarantees the artwork exists transitively (an RFQ always carries a `fraction_contract_id`, and
`fraction_contracts.artwork_id → artworks`). Keeping both means every RFQ insert takes a `FOR KEY SHARE` lock on
**two** parent tables (artworks *and* fraction_contracts) plus a second FK validation.

## Findings
Sources: performance-oracle (P3) + data-integrity-guardian (P3, "arguably defensive"). Trade-off worth a
deliberate decision:
- The single FK is only non-redundant for an artwork that has **zero** fraction_contracts — but an RFQ can never
  reference such an artwork (it always snapshots a `deployed` contract via the composite FK), so in practice the
  single FK adds nothing the composite one doesn't already enforce.

- `src/database/migrations/1716000000041-CreateRfqsTable.ts:55-58`

## Proposed Solutions
### Option A — Drop `FK_rfqs_artwork`, keep only the composite FK
- Description: New forward migration drops the single-column FK; the composite FK covers artwork existence.
- Pros: One parent lock + one FK validation per insert; less write overhead + contention.
- Cons: A new migration; loses the (unreachable-in-practice) zero-contracts guard.
- Effort: Small
- Risk: Low

### Option B — Keep both (accept as defensive)
- Description: Leave as-is; document that the single FK is intentional belt-and-suspenders.
- Pros: Zero change; explicit artwork FK for readers.
- Cons: Redundant lock/validation on every insert.
- Effort: None
- Risk: Low

## Recommended Action
Option A — drop FK_rfqs_artwork. Approved 2026-08-21 (edited migration 041 in place).

## Resolution
Removed the single-column `FK_rfqs_artwork (artwork_id) → artworks(id)` from migration 041; the composite
`FK_rfqs_artwork_fc (artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id)` already
guarantees artwork existence transitively (fraction_contracts.artwork_id → artworks). One parent lock +
validation per insert instead of two. Added an integration test asserting `rfqs` has exactly the composite
FK and NOT `FK_rfqs_artwork`. Verified: build 0, integration 9/9, e2e 11/11.

## Technical Details
- If dropped, verify no query/tooling relies on the named `FK_rfqs_artwork` constraint.

## Acceptance Criteria
- [ ] Decision recorded; if Option A, migration drops the FK and inserts still satisfy referential integrity.

## Work Log
- 2026-08-21 — Filed from PR #46 review (performance-oracle, data-integrity-guardian).

## Resources
- PR #46; migration `1716000000041`.
