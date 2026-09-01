---
status: complete
priority: p3
issue_id: 345
tags: [code-review, data-integrity, data-migration, tov-165]
dependencies: []
---
# Backfilled `cleared_allocations` is tautological vs `public_float` for historical rows (PR #45)

## Problem Statement
The forward/worker path computes `cleared_allocations_stroops` as an INDEPENDENT Σ of winner allocations — which
is precisely what makes `CHK_clearing_alloc_eq_float` a genuine cross-check against a corrupted allocation map. The
migration's backfill of PRE-EXISTING settled rows instead sets `cleared_allocations_stroops = public_float`, so the
CHECK passes tautologically for those historical rows and cannot catch a pre-existing corrupted `allocation_map`.

## Findings
Sources: data-migration-expert (Finding 3), data-integrity-guardian (L2).

- `src/database/migrations/1716000000040-AddOfferingSettlementSnapshotColumns.ts:95-104` — the audit backfill sets
  `cleared_allocations_stroops = a.public_float` (by definition) rather than summing the per-winner `allocatedCount`
  values already present in the `allocation_map` jsonb.
- Immaterial in practice: real settlement is chain-gated so prod has ~0 settled audit rows, and the `Σ allocated ==
  public_float` invariant held at settle time under TOV-160/162. This only weakens the "independent cross-check"
  claim for backfilled rows in dev/staging (where Fake-adapter settlements exist).

## Proposed Solutions
### Option A — Re-derive from allocation_map in the backfill (recommended if kept)
- Description: Replace `cleared_allocations_stroops = a.public_float` with a sum over the jsonb `allocation_map`
  (`SELECT sum((elem->>'allocatedCount')::numeric) FROM jsonb_array_elements(a.allocation_map) elem`), so historical
  rows get the same independent-Σ guarantee as forward-written rows. The assertion + CHECK then genuinely validate.
- Pros: Backfilled rows carry the same integrity guarantee; no tautology.
- Cons: More complex backfill SQL; zero prod rows to protect today.
- Effort: Small
- Risk: Low

### Option B — Accept as-is (document only)
- Description: Leave the backfill; note that the independent-Σ guarantee applies to forward-written rows only (the
  ones that matter once the chain-gate lifts), and historical dev/staging rows are tautological.
- Pros: Zero churn; the invariant held at settle time anyway.
- Cons: The "self-contained mint proof" is slightly weaker for backfilled rows.
- Effort: Small (comment only)
- Risk: Low

## Recommended Action
Option A (re-derive from allocation_map) — user-confirmed 2026-08-21.

## Resolution
Applied Option A. Migration `1716000000040` part-2 backfill now sets `cleared_allocations_stroops = COALESCE(
(SELECT sum((elem->>'allocatedCount')::numeric) FROM jsonb_array_elements(allocation_map) elem), 0)` — the
INDEPENDENT Σ of winner allocations from the frozen `allocation_map`, not a copy of `public_float`. So for
historical rows too, a corrupted `allocation_map` yields `Σ <> public_float`, which the existing pre-VALIDATE
assertion + `CHK_clearing_alloc_eq_float` catch (loud abort), matching the forward/worker path's independent Σ.
`COALESCE` guards an empty map.

Note: the migration's backfill can't be re-run inside the vitest harness (migrations load out-of-band via
`db:test:setup`), so instead added integration test **I7** exercising the load-bearing aggregation directly
(`sum((elem->>'allocatedCount')::numeric)` over a realistic `ClearingAllocationRow[]` map → 400+500+100=1000;
empty map → 0). Re-provisioned `tove_test`; migration applies cleanly; integration 201 (+I7) green.

## Technical Details
- File: `src/database/migrations/1716000000040-AddOfferingSettlementSnapshotColumns.ts:95-104`.
- Editing an applied migration requires re-provisioning `tove_test` (dropdb + db:test:setup).

## Acceptance Criteria
- [ ] Decision recorded (re-derive vs accept-and-document).
- [ ] If Option A: backfill sums `allocation_map`; integration test seeds a legacy row with a mismatched
      `allocation_map` and asserts the backfill/assertion catches it.

## Work Log
- 2026-08-21: Filed from PR #45 review (data-migration Finding 3 + data-integrity L2). Not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/45
