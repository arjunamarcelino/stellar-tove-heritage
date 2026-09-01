---
status: complete
priority: p3
issue_id: 276
tags: [code-review, test-quality, performance, TOV-153, PR-38]
dependencies: []
---

# EXPLAIN index-scan test asserts an inlined-literal query, not the real parameterized finder

## Problem Statement
The integration test that asserts `findActiveByArtworkId` is served by an index scan
(`offering-active-read.integration.spec.ts`, the EXPLAIN case) hand-writes a raw SQL query with an
**inlined** `status = ANY(ARRAY['planned',...])` literal list against a **1-row** seeded table. It
does NOT exercise the repository's actual **parameterized** `In($2,$3,$4,$5)` query. Two consequences:
1. Postgres can prove partial-index predicate-implication for the inlined literals (custom plan), so
   the test passes — but the production query binds params, and under a generic plan (or if
   prepared-statement caching / PgBouncer is ever introduced) it may **not** match the partial-index
   predicate and could seq-scan. The test therefore **overstates** the guarantee it provides.
2. On a 1-row table Postgres may legitimately pick a seq scan anyway, making the assertion inherently
   brittle.

Correctness is unaffected (the ≤1-row guarantee comes from the write-time unique index, not the read
plan), and at MVP row counts a seq scan is harmless. This is test-fidelity / gold-plating only. The
**`pg_indexes` predicate drift-guard in the same file is the genuinely load-bearing test and must
stay.**

## Findings
Converged across **three** reviewers:
- **performance-oracle (P3):** "the index predicate uses literal `status IN (...)` while TypeORM emits
  parameterized `status IN ($2,$3,$4,$5)` … if prepared-statement caching or generic plans are ever
  introduced … this read would fall back to a seq scan."
- **data-integrity-guardian (P3):** "the test asserts against an inlined `ARRAY[...]` literal, not the
  repository's actual parameterized `In(...)` query … the test overstates the guarantee it provides."
- **code-simplicity-reviewer (P3):** "Fragile EXPLAIN / index-scan test is gold-plating … tests the
  planner, not the code … this EXPLAIN test should be dropped."
- Evidence: the EXPLAIN block in `test/integration/modules/offerings/offering-active-read.integration.spec.ts`.

## Proposed Solutions
### Option A — Drop the EXPLAIN test; keep the `pg_indexes` drift-guard
- **Pros:** removes a brittle, overstating test; the load-bearing predicate-parity guard remains.
- **Cons:** loses the (weak) seq-scan regression signal. **Effort:** Small. **Risk:** None.

### Option B — Make it faithful: EXPLAIN the real finder query on a populated table
- Seed enough rows that the planner prefers the index; ideally capture the SQL TypeORM emits (or
  `EXPLAIN` a `$n`-parameterized statement) rather than an inlined literal; optionally `SET
  enable_seqscan = off` to make intent explicit; add a repo/migration note that the partial index
  relies on custom-plan param folding.
- **Pros:** a real regression guard. **Cons:** more test machinery; still planner-dependent.
  **Effort:** Medium. **Risk:** Low.

### Option C — Replace with a migration/repo doc note only
- Document that `offerings` has no plain `(artwork_id)` btree and the partial index depends on
  custom-plan param folding; add a plain `(artwork_id)` index if/when an all-status read path appears.
- **Effort:** Trivial. **Risk:** None.

## Recommended Action
**Option A + note (chosen).**

## Resolution
Removed the EXPLAIN/index-scan `it(...)` from the integration spec (it asserted an inlined-literal query
on a 1-row table, not the real parameterized finder, so it overstated its guarantee). Kept the
load-bearing `pg_indexes` predicate drift-guard. Added a repo comment on
`OfferingRepository.findActiveByArtworkId` documenting that `offerings` has no plain `(artwork_id)`
btree, that the partial index is used only when Postgres proves `status IN (...)` implies the predicate
(holds under custom plans / param folding, the default), and to re-check with EXPLAIN or add a plain
index if generic plans / a statement cache / PgBouncer are introduced. Verified: integration spec green
(10 tests).

## Technical Details
- `test/integration/modules/offerings/offering-active-read.integration.spec.ts` (EXPLAIN case)
- `src/modules/offerings/repositories/offering.repository.ts:19-23`
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts` (partial index, no plain artwork_id btree)

## Acceptance Criteria
- [ ] The EXPLAIN case is either removed or rewritten to exercise the real finder / populated table.
- [ ] The `pg_indexes` predicate drift-guard is retained.
- [ ] Integration suite green.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38). Convergent P3 from performance, data-integrity, and
  simplicity reviewers. Not a correctness issue; test-fidelity + scale-regression guard.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
