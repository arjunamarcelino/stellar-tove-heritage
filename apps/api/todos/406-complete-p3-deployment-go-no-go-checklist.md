---
status: complete
priority: p3
issue_id: 406
tags: [code-review, tov-191, pr-51, deployment, ops, migration]
dependencies: []
---
# Deployment Go/No-Go checklist — TOV-191 artwork timeline (informational)

## Resolution (2026-08-24)
Promoted this checklist to a durable deploy runbook matching the repo convention (TOV-156/160/172/174 all
keep runbooks under `docs/solutions/deployment-issues/`): **`docs/solutions/deployment-issues/2026-08-24-tov191-artwork-timeline-deploy-runbook.md`**.
Updated it to reflect the review fixes landed in this pass (guard now blocks delete #400, `is_published`
DEFAULT false #402, the new `resolveArtworkId failed` log line #401). No code change — informational.

## Problem Statement
Reference checklist for shipping PR #51 (produced by the deployment-verification agent). Not a defect — a deploy runbook. Change surface: net-new empty table `artwork_timeline_events` (migration `1716000000047`, forward-only, no backfill) + anonymous public read endpoint + best-effort post-commit emit from two existing workers. No new env vars. Risk: **LOW** (empty additive table, lossy-by-design emit). **Bottom line: routine additive deploy.**

## Pre-Deploy (Go/No-Go gate)
- [ ] Confirm migration ordering: prod is at `046` (TOV-189/PR #50), `047` ABSENT/pending. `SELECT name FROM migrations ORDER BY timestamp DESC LIMIT 3;`
- [ ] `artworks` table not under a long write — the only existing-table lock is the FK-validation lock on `artworks` (`FK_ate_artwork`), bounded by `SET LOCAL lock_timeout='3s'`. An abort here is safe/transactional; just retry when idle.
- [ ] New-table indexes take ACCESS EXCLUSIVE on an invisible-until-COMMIT table → zero contention. No pre-deploy row-count gate needed.
- [ ] `NODE_ENV` is production-like so the `down()` prod-guard is armed.

## Deploy + post-migration verification SQL
- [ ] `yarn migration:run`, then:
```sql
SELECT to_regclass('public.artwork_timeline_events') IS NOT NULL AS table_ok;            -- t
SELECT is_generated, generation_expression FROM information_schema.columns
  WHERE table_name='artwork_timeline_events' AND column_name='visibility_tier';           -- ALWAYS + CASE
SELECT indexname FROM pg_indexes WHERE tablename='artwork_timeline_events' ORDER BY 1;    -- IDX_ate_all, IDX_ate_tier, PK_..., UQ_ate_source_ref
SELECT indexdef FROM pg_indexes WHERE indexname='UQ_ate_source_ref';                      -- NO "WHERE" (full unique)
SELECT tgname FROM pg_trigger WHERE tgrelid='artwork_timeline_events'::regclass AND NOT tgisinternal; -- trg_ate_guard
SELECT conname, contype FROM pg_constraint WHERE conrelid='artwork_timeline_events'::regclass ORDER BY 1; -- CHK_ate_event_type, FK_ate_artwork, PK_...
```

## Post-deploy verification (5 min)
- [ ] `GET /api/v1/artworks/{visible-id}/timeline` → `200 {events:[], additionalEventsCount:0, nextCursor:null}` (forward-only, empty).
- [ ] Non-visible / non-UUID id → identical non-oracle `404 ARTWORK_NOT_FOUND`.
- [ ] Emit smoke: after one deploy OR one settlement, `SELECT event_type, visibility_tier, source_ref FROM artwork_timeline_events ORDER BY created_at DESC LIMIT 5;` (fractionalization/secondary_trade, tier `default`).

## Config to verify
- [ ] **No new env vars** (confirm `git diff` didn't touch `validation-schema.ts` / `app.config.ts`).
- [ ] **`TRUST_PROXY_HOPS` correct** — the new anonymous read route is IP-throttled (30/min); a wrong hop count collapses all callers into one bucket (mass false throttling) or trusts a spoofable `X-Forwarded-For`. Pre-existing var, now load-bearing.

## Monitoring (first 24h — best-effort/lossy by design)
- [ ] Watch `timeline emit failed [type=… ref=…]` (ERROR, `timeline-emit.service.ts`). By design does NOT fail the money action. Low rate = informational, NOT a rollback trigger.
- [ ] Watch `timeline emit skipped: no artwork_id for fraction_contract …` (WARN) — a trade with a missing contract row; investigate, not a blocker.
- [ ] Accept lossy semantics: fire-and-forget + `ON CONFLICT (source_ref) DO NOTHING`; a failed emit self-heals on any job retry / reconcile. **No dedicated timeline reconciler and no emit-success metric** — a counter/dashboard is a follow-up (see also the plan's Open Q5). Log-based alerting is the current surface.

## Rollback
- [ ] `down()` is prod-guarded and THROWS outside dev/test — **do not `migration:revert` in prod**.
- [ ] Rollback = redeploy the previous commit (`a48bc4c`); leave the `047` table in place (additive + inert; old code ignores it). Removing the two worker `TimelineModule` imports comes with the redeploy — no orphaned refs.
- [ ] Emergency-only manual drop (irreversible provenance loss; safe only while near-empty): `DROP TRIGGER … ; DROP FUNCTION fn_ate_guard(); DROP TABLE artwork_timeline_events;`

## Worker ordering
- [ ] Both emitting workers gained a neutral `TimelineModule` import (no Soroban probe, no controller dragged in) → cannot fail worker boot for config/secret reasons.
- [ ] Code-before-schema-safe: if new worker code runs before `047`, the emit INSERT throws → caught → logged; the deploy/settle still commits. Prefer standard order (migrate `047`, then roll workers) to avoid a burst of spurious `timeline emit failed` logs.
- [ ] No new queue, no concurrency/lockDuration change → standard rolling deploy, no drain needed.

## Acceptance Criteria
- [ ] Checklist executed at deploy time (or promoted into `docs/solutions/deployment-issues/` as a runbook).

## Work Log
- 2026-08-24: Filed from PR #51 review (deployment-verification-agent).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
- Migration: `src/database/migrations/1716000000047-CreateArtworkTimelineEvents.ts`
