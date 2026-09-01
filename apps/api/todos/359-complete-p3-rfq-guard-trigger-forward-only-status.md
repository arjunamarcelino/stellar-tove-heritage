---
status: complete
priority: p3
issue_id: 359
tags: [code-review, data-integrity, tov-172]
dependencies: []
---
# `fn_rfqs_guard` does not enforce a forward-only status machine (allows e.g. `filled → open`) (PR #46)

## Problem Statement
The RFQ guard trigger freezes the money-intent columns and blocks delete/soft-delete, but it permits **any**
`status` transition within the CHECK vocabulary — including backward moves like `filled → open` or
`expired → open`. The sibling `fn_offering_bids_guard` (migration 036) enforces a forward-only status machine.
For TOV-172 there is no code path that writes `status` yet (create-only scope), so this is not currently
reachable — but the later M06 FRs (quote accept → `filled`, cancel → `canceled`, expiry sweep → `expired`) will
mutate status, and without a DB-level forward-only guard a bug could regress a terminal RFQ back to `open`.

## Findings
Source: data-migration-expert (P3). Flagged so the divergence from the 036 pattern is a conscious decision.

- `src/database/migrations/1716000000041-CreateRfqsTable.ts:73-98` (`fn_rfqs_guard`)

## Proposed Solutions
### Option A — Add a forward-only status machine to the trigger when status writes land
- Description: When FR-06.02/03 introduce status transitions, extend `fn_rfqs_guard` (via a forward migration) to
  allow only `open → filled|canceled|expired` and reject backward/lateral terminal moves — mirroring
  `fn_offering_bids_guard`.
- Pros: DB-level guarantee that a terminal RFQ can't regress; matches the money-table precedent.
- Cons: Best defined alongside the actual transition semantics (which are out of scope for TOV-172).
- Effort: Small (when done with the transition FR)
- Risk: Low

### Option B — Enforce forward-only in the service layer only
- Description: Rely on CAS-style service updates (like offerings) to gate transitions; leave the trigger as a
  freeze-only guard.
- Pros: No trigger change.
- Cons: No DB backstop; a stray UPDATE could regress status.
- Effort: n/a now
- Risk: Low-Medium (depends on discipline)

## Recommended Action
Option A — add the forward-only guard now. Approved 2026-08-21 (edited migration 041 in place).

## Resolution
Extended `fn_rfqs_guard` to enforce a forward-only status machine: only `open → filled|canceled|expired` is
allowed; any backward or terminal→terminal move raises `illegal status transition` (mirrors
`fn_offering_bids_guard`). No code writes status yet (create-only scope), but the DB backstop prevents a
future bug from regressing a terminal RFQ to `open`. Added an integration test covering the allowed forward
move plus rejected backward (canceled→open) and terminal→terminal (canceled→filled) moves. Verified: build 0,
integration 9/9, e2e 11/11.

## Technical Details
- Not reachable in TOV-172 (create-only). This is a forward-looking note for FR-06.02/06.03.

## Acceptance Criteria
- [ ] When status transitions are implemented, the trigger (or a documented CAS strategy) enforces forward-only.

## Work Log
- 2026-08-21 — Filed from PR #46 review (data-migration-expert).

## Resources
- PR #46; migration `1716000000041`; `fn_offering_bids_guard` in migration `1716000000036`.
