---
status: complete
priority: p2
issue_id: 302
tags: [code-review, deployment, database, ops]
dependencies: []
---
# Rolling-deploy migration auto-run race + deploy/rollback/monitoring runbook for offering_bids

## Problem Statement
`migrationsRun` defaults to true (`database.config.ts:10`), so on a multi-replica rolling deploy every booting replica attempts migration 036 concurrently. Combined with the FK install on `offerings` under the 3s `lock_timeout`, a losing replica can fail to boot. Additionally, `down()` is fail-closed in prod (no automated schema rollback — manual/DBA only), and the deferred reconciler (todo 294) means stuck `submitted` bids need a monitoring alert as the compensating control. Only the local `tove_test` DB has been migrated — shared/remote DBs need 036 applied at deploy time. A deploy runbook is required before go-live.

## Findings
- `src/config/database.config.ts:10` — `migrationsRun: process.env.DB_MIGRATIONS_RUN !== 'false'` (auto-run on every boot by default).
- migration `1716000000036-CreateOfferingBidsTable.ts` — creates FK to `offerings` (brief ShareRowExclusive lock on the parent), runs under `SET lock_timeout='3s'`; `down()` throws unless `NODE_ENV` is dev/test (fail-closed in prod).
- All `OFFERING_BID_*` env vars have defaults (no new required env at boot), so a first-boot config gap is not the risk — the migration race is.
- Only `tove_test` has been migrated locally; shared/remote environments still need 036.

## Proposed Solutions
### Option A — Pre-deploy migration release step
- Description: Run 036 as a single pre-deploy release step, with `DB_MIGRATIONS_RUN=false` on app instances (or gate migration to a single first-replica). Document the manual rollback posture ("roll back the app, leave the additive table in place") and add a stuck-`submitted` monitoring query/alert as the compensating control for the deferred reconciler.
- Pros: Eliminates the concurrent-migration race entirely; explicit, auditable ordering; clear rollback posture; monitoring covers the deferred-reconciler gap.
- Cons: Mostly an ops/process change; requires CI/CD pipeline wiring and discipline.
- Effort: Small (mostly ops)
- Risk: Low

### Option B — Auto-run with single-replica-first rollout
- Description: Keep auto-run but ensure the rollout brings up a single replica first (which runs the migration) before scaling out.
- Pros: Minimal pipeline change.
- Cons: Riskier — depends on orchestrator honoring single-replica-first ordering; still no explicit rollback/monitoring guidance without additional docs.
- Effort: Small
- Risk: Medium

### Option C — Advisory-lock guarded migration
- Description: Wrap the migration in a PG advisory lock so concurrent replicas serialize rather than race under `lock_timeout`.
- Pros: Safe under concurrency without changing rollout mechanics.
- Cons: Changes migration code; still leaves rollback/monitoring runbook undocumented.
- Effort: Small-Medium
- Risk: Low-Medium

## Recommended Action

## Technical Details
Post-deploy verification SQL (confirm the migration landed fully):
```sql
-- table present
SELECT to_regclass('public.offering_bids');
-- trigger present (updated_at)
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.offering_bids'::regclass AND NOT tgisinternal;
-- indexes present
SELECT indexname FROM pg_indexes WHERE tablename = 'offering_bids';
-- generated column present
SELECT column_name, is_generated FROM information_schema.columns
WHERE table_name = 'offering_bids' AND is_generated = 'ALWAYS';
```
Stuck-bid monitoring query (compensating control for the deferred reconciler, todo 294):
```sql
SELECT id, offering_id, created_at
FROM offering_bids
WHERE status = 'submitted' AND created_at < now() - interval '10 minutes';
```
Rollback posture: `down()` is fail-closed in prod; rollback = roll back the app version and leave the additive `offering_bids` table in place (manual/DBA schema change only if truly required).

## Acceptance Criteria
- A documented deploy runbook — migration ordering per environment, rollback posture, and the stuck-`submitted` monitoring alert — is attached to the PR/ticket before go-live.
- Shared/remote DBs have 036 applied as part of the deploy sequence.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Wrote a durable deploy runbook: `docs/solutions/deployment-issues/2026-08-20-tov156-offering-bids-deploy-runbook.md`.
It covers:
- **Migration ordering:** run `…036` as a single pre-deploy step with `DB_MIGRATIONS_RUN=false` on app
  instances (avoids the multi-replica auto-run race on the FK install), with verification SQL.
- **Rollback:** `down()` is fail-closed in prod → manual/DBA-gated; the posture is "roll back the app, leave
  the additive table" (drop SQL included for the true-removal case).
- **Config/boot:** all `OFFERING_BID_*` have defaults (no new required env); reuses existing relayer + Redis.
- **BullMQ across restart:** idempotent re-drive via the no-op reload guard.
- **Monitoring:** the stuck-`submitted` alert query (the required compensating control for the deferred
  reconciler, todo 294) + the queue-depth / failure-rate / relayer-balance signals, and a manual-recovery
  procedure for a stranded bid.

Documentation only (no code change). This runbook should be linked from the PR before go-live.
