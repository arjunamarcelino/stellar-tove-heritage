---
status: complete
priority: p2
issue_id: 388
tags: [code-review, tov-177, pr-49, migration, deployment, postgres]
dependencies: []
---
# Migration 045 holds ACCESS EXCLUSIVE on `rfq_quotes` for the whole txn (unbounded by `lock_timeout`, blocks reads)

## Problem Statement
Migration `1716000000045` is otherwise **sound and faithful to sibling conventions** (single-transaction, superset
CHECK widening, `CREATE OR REPLACE` of an already-attached trigger, fail-closed `down()` — all verified). The one
deploy caveat: it takes `ACCESS EXCLUSIVE` on the **existing, populated** `rfq_quotes` table at the first `ALTER`
and holds it to COMMIT across a CHECK re-validation scan, the `UQ_quotes_id_rfq` unique-index build, AND the
entire `secondary_trades` create + 4 index builds. `SET LOCAL lock_timeout='3s'` bounds only the *wait to acquire*
each lock — **not** the work done while holding it (there is no `statement_timeout`). So for that whole duration
`rfq_quotes` is fully unavailable — the lock blocks **reads too**, not just writes as the header comment (`:18`)
implies. Sub-second on today's young table; a real stall on the live accept-quote path if `rfq_quotes` has grown
large by deploy time.

## Findings
- `src/database/migrations/1716000000045-...ts:26` (`SET LOCAL lock_timeout='3s'`) vs `:40-50` (`ADD CONSTRAINT
  CHECK` re-scan + `ADD CONSTRAINT UNIQUE` build) — lock_timeout does not bound the held work.
- Header comment `:18` says "low-write window" but ACCESS EXCLUSIVE blocks reads as well — misleading for the
  operator.
- Verified SAFE (no defect): CHECK widening is a true superset (adds only `'superseded'`); `CREATE OR REPLACE
  FUNCTION fn_quotes_guard` mid-txn is safe (exclusive lock blocks trigger execution until COMMIT; trigger binds
  by name); `down()` ordering correct + fail-closed.

## Proposed Solutions
### Option A — Ship as-is in a low-traffic window + fix the comment + gate on row count (Recommended)
- Pre-deploy: `SELECT count(*) FROM rfq_quotes;`. If small (< ~100k), deploy in a low-traffic window — the stall
  is sub-second. Fix the `:18` header wording to say the table is briefly unavailable for **reads and writes**.
- Pros: zero migration restructuring, keeps single-txn atomicity. Cons: still a brief full stall. Effort: Small.

### Option B — Split into non-blocking steps (only if `rfq_quotes` is large at deploy)
- `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` (SHARE UPDATE EXCLUSIVE, non-blocking) for the CHECK;
  `CREATE UNIQUE INDEX CONCURRENTLY` + `ADD CONSTRAINT ... USING INDEX` for `UQ_quotes_id_rfq`. Breaks single-txn
  atomicity, so only worth it at real scale. Effort: Medium · Risk: Medium (loses atomic rollback).

## Recommended Action
Option A — confirm row count, deploy in a low-traffic window, correct the header comment. Escalate to B only if
`rfq_quotes` has grown materially.

## Technical Details
- Affected: migration `1716000000045` (comment only under Option A). Rollback note: `down()` is dev/test-gated;
  once any quote reaches `'superseded'`, the CHECK-narrowing revert intentionally fails — production rollback path
  is redeploy-previous-commit, not `migration:revert` (correct for a table holding settled-trade provenance).

### Pre-deploy SQL (gate the decision)
```sql
SELECT count(*) AS rfq_quotes_rows FROM rfq_quotes;
SELECT status, count(*) FROM rfq_quotes GROUP BY status ORDER BY status;   -- expect only the old 4 values
SELECT conname FROM pg_constraint WHERE conname IN ('CHK_quotes_status','UQ_rfqs_id_fc');
SELECT tgname FROM pg_trigger WHERE tgname='trg_quotes_guard' AND NOT tgisinternal;
```
### Post-deploy SQL (prove shape landed): see the migration-review notes (5 nullable cols, widened CHECK,
`UQ_quotes_id_rfq`, `secondary_trades` constraints/generated col/indexes, guard trigger, overflow smoke test).

## Acceptance Criteria
- [ ] `rfq_quotes` row count confirmed small before deploy (or Option B chosen).
- [ ] Header comment corrected to state reads are blocked too.
- [ ] Post-deploy verification queries pass.

## Resolution (2026-08-22, complete — Option A: ship as-is + accurate comment + pre-deploy gate)
The migration is functionally sound (verified: superset CHECK widening, safe `CREATE OR REPLACE` under the
exclusive lock, correct fail-closed `down()`), so no DDL change. Corrected the misleading header comment: the
ACCESS EXCLUSIVE lock is HELD to COMMIT across the CHECK re-scan + `UQ_quotes_id_rfq` build + the whole
`secondary_trades` create, blocks **reads as well as writes**, and `lock_timeout` bounds only the acquire-wait
(no `statement_timeout`). Documented the pre-deploy row-count gate inline (ship as-is if `rfq_quotes` is small;
otherwise split to `ADD ... NOT VALID`+`VALIDATE` and `CREATE UNIQUE INDEX CONCURRENTLY`) and the expected
status distribution check. The full pre/post-deploy SQL and rollback note live in this todo's "SQL verification
queries" section for the operator.

Verified: build 0, lint clean (comment-only; no schema/behavior change — the migration is already applied in
`tove_test`).

### Files changed
- `src/database/migrations/1716000000045-AddSecondaryTradesAndSellerAuth.ts` (header comment)

## Work Log
- 2026-08-22: Filed from PR #49 review (migration expert P2).
- 2026-08-22: Corrected the lock-hold comment + documented the pre-deploy gate (Option A); marked complete.
