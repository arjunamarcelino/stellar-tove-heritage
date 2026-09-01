---
status: complete
priority: p3
issue_id: 437
tags: [code-review, tov-33, pr-56, deployment, runbook, ops]
dependencies: []
---
# Rotation deploy / runbook notes (migrations 052/053/054)

## Resolution (2026-08-27)
No code defect — GO. Captured as the house-convention deploy runbook:
`docs/solutions/deployment-issues/2026-08-27-tov33-wallet-rotation-deploy-runbook.md` (migrations 052–056,
migrate-before-deploy ordering, code-only rollback, verification SQL, monitoring, and the backfill false-ALLOW /
TRUNCATE caveats). The migrations are lock-bounded, expand-only, and prod-guarded on `down()`.

## Problem Statement
Deployment-verification assessment for PR #56: **GO, no P1 blockers.** All three migrations are lock-bounded,
expand-only, and prod-guarded on `down()`. Captured here as ops guidance (not code defects).

## Findings / Runbook
- **Migrate-before-deploy is REQUIRED (P2 ops gate).** New code maps `fraction_contracts.artist_lockup_until`
  (`fraction-contract.entity.ts`) and writes it via `casDeployed` (`fraction-contract.repository.ts`). If new code
  boots before migration 052, any `fraction_contracts` query/deploy-write throws `column … does not exist`. Run
  052/053/054 → then deploy code. Backward compat (rollback direction) is safe: old code omits the new column/tables.
- **Rollback = code-only.** All three `down()` fail closed outside dev/test (lockup anchor / in-flight tx state /
  append-only provenance). Redeploy the previous app version and leave migrations in place — nothing was destroyed
  or transformed, so there is no data to restore.
- **No `CONCURRENTLY` needed** — every 053/054 index is on a brand-new empty table (instant); 052 is a metadata-only
  `ADD COLUMN` (no index). The single-UPDATE backfill on `fraction_contracts` is fine (tiny table; one row per
  fractionalization).
- **Backfill false-ALLOW caveat (P3).** 052 backfills `artist_lockup_until = EXTRACT(EPOCH FROM created_at) +
  artist_lockup_days*86400` — a request-time anchor that precedes the on-chain deploy close-time, so a legacy
  `deployed` row can false-ALLOW at the rotation lockup gate (`now < until` reads slightly early). Backstopped by
  the on-chain FractionToken (locked transfer fails at submit re-sim, not a clean 422). New deploys carry the exact
  value; the reconcile crash-path leaves it NULL (treated as "not subject"). Flag for the rotation-gate owner so a
  "why was a locked rotation attempted" support ticket isn't a surprise. (see also todo 433)
- **`TRUNCATE` bypasses the append-only trigger (P3 informational).** `trg_registry_events_guard` is `FOR EACH ROW`
  → it blocks app-level UPDATE/DELETE but not a DBA `TRUNCATE registry_events`. Provenance protection is against
  app mutation, not DBA action.

## Verification SQL (post-deploy, within 5 min)
```sql
-- 052 column present + all deployed rows backfilled, no absurd anchors
SELECT data_type, is_nullable FROM information_schema.columns
 WHERE table_name='fraction_contracts' AND column_name='artist_lockup_until';           -- bigint, YES
SELECT count(*) FROM fraction_contracts WHERE status='deployed' AND artist_lockup_until IS NULL;   -- 0
SELECT count(*) FROM fraction_contracts WHERE artist_lockup_until IS NOT NULL AND artist_lockup_until <= 0; -- 0
-- 053/054 tables + append-only trigger live
SELECT to_regclass('public.wallet_rotation_transfers'), to_regclass('public.wallet_rotation_transfer_items'),
       to_regclass('public.registry_events');
SELECT tgname FROM pg_trigger WHERE tgrelid='registry_events'::regclass AND NOT tgisinternal; -- trg_registry_events_guard
-- prove immutability (throwaway txn, MUST error then ROLLBACK)
BEGIN; UPDATE registry_events SET ledger = ledger WHERE false; ROLLBACK;   -- expect "append-only" error
```

## Monitoring (first 24h)
- `column … does not exist` on `fraction_contracts` → new code started before 052 (roll code back, migrate, redeploy).
- `lock_timeout` aborts on the 052 ALTER → retry in a quiet window.
- `registry_events is append-only` from app code → a path is wrongly attempting UPDATE/DELETE (should be impossible
  given `ON CONFLICT DO NOTHING`).

## Resources
- PR #56; reviewer: deployment-verification-agent. Pairs with the runbook convention (`docs/solutions/deployment-issues/`).
