---
status: complete
priority: p3
issue_id: 347
tags: [code-review, quality, testing, tov-165]
dependencies: []
---
# Extract a shared `seedOffering` test helper to stop offering-INSERT drift (PR #45)

## Problem Statement
~7 integration/e2e specs each hand-roll a near-identical raw `INSERT INTO offerings (...)` with drifting column
lists and param styles (`$1..$10` vs inline literals vs mixed). Every schema addition since TOV-152 ripples across
all of them — PR #45 alone had to touch 12 offering-insert sites across 7 files to add the 3 new NOT-NULL columns.
A single shared seed helper would collapse that fan-out.

## Findings
Source: code-simplicity-reviewer (item 2).

- Files with hand-rolled offering inserts: `test/integration/modules/offerings/{offerings.constraints,
  offering-active-read,offering-approval.constraints,offering-bid.constraints,offering-clearing}.integration.spec.ts`,
  `test/e2e/{offering-bid,offering-bid-cancel,offering-settlement,offering-approval,backoffice-artwork-detail-offering}.e2e-spec.ts`.
- The mechanical per-file edits in PR #45 were the CORRECT minimal fix for the ticket (values genuinely differ per
  test — some use `total_supply=public_float,0,0`; the clearing spec uses `150/30/20` to exercise the decomposition
  CHECK). This todo is the follow-up refactor, deliberately out of scope for the reconcile-deltas PR.

## Proposed Solutions
### Option A — `seedOffering(q, overrides)` helper in `test/shared/`
- Description: A helper taking a query runner + overrides that inserts an offering with sane, decomposition-consistent
  defaults (e.g. `total_supply = public_float, retentions = 0` unless overridden). Specs pass their own `q`/`dataSource`
  and only the fields they care about.
- Pros: One place to update on future schema additions; kills the drift.
- Cons: Non-trivial — specs use different `q`/`dataSource` handles and column subsets; must preserve each spec's
  intent (e.g. the clearing spec needs non-zero retentions to exercise the CHECK).
- Effort: Medium
- Risk: Low (test-only)

### Option B — Leave as-is
- Description: Accept the per-spec inserts.
- Pros: Zero churn.
- Cons: The next money-column addition ripples across ~7-12 sites again.
- Effort: None
- Risk: Low

## Recommended Action
Option A (extract the shared helper now) — user-confirmed 2026-08-21.

## Resolution
Created `test/shared/seed-offering.ts` exporting `insertOffering(q, opts)` — a non-generic `QueryFn`
(`(text, params?) => Promise<unknown[]>`, casts the RETURNING row internally) so every spec's `q`/`ds.query`
handle is assignable without generic-variance friction. Defaults are decomposition-consistent
(`total_supply = public_float`, retentions 0); windows default to open-2d-ago/close-1d-ago; supports
`onConflictDoNothing` + a client `id`.

Migrated **10 offering inserts across 9 specs** to the helper: integration — offering-clearing,
offering-active-read (delegates, preserving its `[{id}]` array contract via aliased import), offering-bid.constraints,
offering-approval.constraints (2 inserts); e2e — offering-bid, offering-bid-cancel, offering-settlement (2 inserts),
offering-approval, backoffice-artwork-detail. Left `offerings.constraints.integration.spec.ts` on its own inserts
deliberately (its offering inserts ARE the subject-under-test, and its local fn is even named `insertOffering`).

Green: build 0, lint 0, unit 875, integration 202 (+5 skip, fresh provision), e2e 230.

**Incidental note (NOT part of this change):** while re-provisioning `tove_test` repeatedly during this work I
surfaced a pre-existing planner-statistics flake in `offering-bid.constraints` I7 ("findMyLatestBid … no Sort")
— on a cold/empty `offering_bids` table the planner picks `IDX_offering_bids_clearing` + Sort over
`IDX_offering_bids_collector`. Confirmed pre-existing/unrelated (reproduces with this change git-stashed) and
green on a clean full `db:test:setup` + full-suite run (warm stats). A robustness follow-up could `ANALYZE`/seed
representative rows in that test, but it is out of scope here and was reverted.

## Technical Details
- New file: `test/shared/seed-offering.ts` (or extend `test/shared/helpers.ts`).
- Must keep the clearing spec's decomposition-exercising values (`150/30/20`) available via overrides.

## Acceptance Criteria
- [ ] A shared `seedOffering` helper exists and is used by the integration + e2e offering specs.
- [ ] All offering/bid/approval/clearing/settlement suites stay green.

## Work Log
- 2026-08-21: Filed from PR #45 simplicity review (follow-up refactor, out of PR scope). Not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/45
