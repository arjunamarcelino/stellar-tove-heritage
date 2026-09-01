---
status: complete
priority: p2
issue_id: 344
tags: [code-review, data-migration, deployment, migration-safety, tov-165]
dependencies: []
---
# Migration 1716000000040 deploy pre-flight SQL + table-wide-lock runbook note (PR #45)

## Problem Statement
Migration `1716000000040` (TOV-165) is fail-safe but has two deploy-time operational risks that are currently
undocumented as pre-flight gates: (a) its backfill assertion can ABORT the whole migration on `fraction_contracts`
decomposition drift / NULL retention, and (b) it holds table-wide `ACCESS EXCLUSIVE` on the **live** `offerings`
table for the full transaction. Neither is a code defect (both fail safe), but an operator running this in prod
should predict them, not discover them mid-deploy. Runbook §8 documents post-deploy verification but not these
two pre-flight checks.

## Findings
Sources: data-migration-expert (Findings 1+2), security-sentinel (L1), data-integrity-guardian (L1), performance-oracle (item 1) — all converged.

- **(deploy-abort risk) The offerings backfill asserts `public_float == current fc decomposition`.**
  `src/database/migrations/1716000000040-AddOfferingSettlementSnapshotColumns.ts:49-70` backfills the 3 offering
  columns from the CURRENT `fraction_contracts` values, then the `DO $$` block aborts if `public_float <>
  total_supply − artist_retention − treasury_retention` or any retention is NULL. `fraction_contracts` money
  columns have no append-only guard (technically mutable), and retention amounts are nullable. If any contract
  drifted after its offering was planned, the migration rolls back with a `RAISE EXCEPTION`. Correct fail-closed
  behavior, but a surprise rollback if not pre-checked. Low likelihood today (chain-gated, few planned rows).
- **(table-wide lock) `offerings` is `ACCESS EXCLUSIVE` for the whole `up()`.** `1716000000040:41-82`. The first
  `ALTER TABLE offerings ADD COLUMN` takes `ACCESS EXCLUSIVE` held to COMMIT; the full-table `UPDATE` + `SET NOT
  NULL` scan + `VALIDATE` all run under it, blocking every read/write to `offerings` (GET :id, bid prepare/submit,
  settle CAS, planning). `SET LOCAL lock_timeout='3s'` bounds only lock *acquisition*, not hold/run time.
  Negligible today — `offerings` cardinality is bounded by one-active-per-artwork (`UQ_offerings_active_per_artwork`),
  so hundreds–low-thousands ever, sub-second — but the lock is genuinely table-wide for the txn duration.

## Proposed Solutions
### Option A — Add pre-flight SQL + a lock note to runbook §8 (recommended)
- Description: Add to the runbook the two pre-flight queries (both must return 0 / be sized) and a one-line note
  that the migration holds table-wide `ACCESS EXCLUSIVE` on `offerings`, so run it in a low-traffic window.
  Drift/NULL check (must return 0 rows):
  ```sql
  SELECT o.id, o.public_float, fc.total_supply, fc.artist_retention_amount, fc.treasury_retention_amount
  FROM offerings o JOIN fraction_contracts fc ON o.fraction_contract_id = fc.id
  WHERE fc.artist_retention_amount IS NULL OR fc.treasury_retention_amount IS NULL
     OR o.public_float <> fc.total_supply - fc.artist_retention_amount - fc.treasury_retention_amount;
  ```
  Size check (informs the window):
  ```sql
  SELECT count(*) AS offering_rows,
         count(*) FILTER (WHERE status IN ('planned','approved','opened','subscribed')) AS live_rows
  FROM offerings;
  ```
- Pros: Turns a potential mid-deploy rollback into a predictable pre-flight gate; documents the real lock profile.
- Cons: Docs-only; doesn't change the fail-safe behavior (which is already correct).
- Effort: Small
- Risk: Low

### Option B — Also make the offerings backfill drift-tolerant (re-derive rather than assert)
- Description: Have the offerings backfill trust the frozen `public_float` and set retentions to satisfy the
  decomposition (e.g. artist=public-derived) instead of asserting against the current fc.
- Pros: Migration can't abort on drift.
- Cons: Would silently paper over a real data-integrity signal (drift SHOULD be surfaced); worse than failing loud.
- Effort: Medium
- Risk: Medium (masks corruption)

## Recommended Action
Option A (runbook-only) — user-confirmed 2026-08-21.

## Resolution
Applied Option A. Added to `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` §8:
(1) a **Lock profile** callout stating the migration holds table-wide `ACCESS EXCLUSIVE` on `offerings` for the
whole txn (`lock_timeout` bounds only acquisition) → run in a low-traffic window; (2) a **Pre-deploy verification
SQL** block with the **P1 drift/NULL check** (must return 0 rows, else the offerings backfill assertion aborts the
migration — reconcile by hand, do not force) and the **P2 size check** (row/live-row count to size the window).
Docs-only; no code change, fail-safe behavior unchanged.

## Technical Details
- Files: `src/database/migrations/1716000000040-AddOfferingSettlementSnapshotColumns.ts`;
  `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` (§8).
- No code change required for Option A (runbook only).

## Acceptance Criteria
- [ ] Runbook §8 includes the drift/NULL pre-flight query (must return 0) before the prod migration step.
- [ ] Runbook §8 includes the offerings size query + a note that the migration holds table-wide ACCESS EXCLUSIVE.
- [ ] The prod run procedure states: run in a low-traffic window with `DB_MIGRATIONS_RUN=false` pinning (already in §8).

## Work Log
- 2026-08-21: Filed from PR #45 multi-agent review (data-migration/security/data-integrity/performance converged). Not fixed per reviewer instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/45
- Related: TOV-160 runbook §1-2, §7 (deploy-drain).
