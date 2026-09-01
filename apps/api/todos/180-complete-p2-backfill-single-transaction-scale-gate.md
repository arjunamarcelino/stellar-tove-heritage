---
status: complete
priority: p2
issue_id: 180
tags: [code-review, deployment, migration, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (gate + checklist; no code change — current scale is GO). Captured the full Go/No-Go
deploy runbook in `docs/solutions/deployment-issues/2026-07-15-create-handle-history-migration-deploy-gate.md`:
per-statement lock profile (no `users` rewrite; only the catalog-only `ADD COLUMN` takes a brief ACCESS
EXCLUSIVE), the **>100k handle-holder gate** for converting the backfill to a batched/post-deploy job,
pre-deploy measurement SQL, post-deploy verification SQL (catalog default, table/index/trigger present,
trigger fires, backfill count == live holders, none missed, canonical correct), prod-guarded rollback with
export step, No-Go conditions, and 24h monitoring. The migration itself is unchanged (safe as written at
current scale); the batched-backfill escape hatch is already noted in the migration header.

# handle_history backfill runs in one migration transaction — add a >100k scale gate + deploy checklist

## Problem Statement
Migration `…024` backfills `INSERT … SELECT FROM users` inside a single migration transaction. It is
deploy-safe at current scale (no `users` rewrite; only the catalog-only `ADD COLUMN` takes a brief ACCESS
EXCLUSIVE), but above ~100k handle-holders the single-transaction WAL/lock footprint is a risk. The
migration comment already notes the >100k escape hatch. Capture the Go/No-Go gate + verification SQL.

## Findings
- `src/database/migrations/1716000000024-CreateHandleHistory.ts:74-81` — single-statement backfill.
- `src/database/migrations/1716000000024-CreateHandleHistory.ts:26-27` — the >100k note.
- `src/database/data-source.ts:16` — `migrationsTransactionMode: 'each'`.

## Proposed Solutions
### Option A: Pre-deploy gate
- **Pros:** measure `SELECT count(*) FROM users WHERE handle IS NOT NULL AND deleted_at IS NULL`; if <~100k GO as-is; if >=~100k, land schema (statements 1-4) here, drop the inline backfill, run it as an idempotent batched (keyset) post-deploy job with the same `WHERE NOT EXISTS` guard. **Cons:** batched path is extra work if threshold hit. **Effort: Small (gate) / Medium (batched job).**

### Option B: Proactively convert the backfill to a batched loop now
- **Pros:** removes the single-transaction risk unconditionally. **Cons:** more complexity now for a scale we're not at. **Effort: Medium.**

## Recommended Action
_(triage — Option A: gate + checklist; only batch if over threshold.)_

## Technical Details
- Files: `src/database/migrations/1716000000024-CreateHandleHistory.ts`; deploy runbook.

## Acceptance Criteria
- [x] Go/No-Go gate + pre/post-deploy verification SQL captured in a runbook (`docs/solutions/deployment-issues/2026-07-15-create-handle-history-migration-deploy-gate.md`); the >100k backfill-batching escape hatch documented.

Deploy-time checklist (to be executed AT deployment, per the runbook — not resolvable now):
- [ ] Pre-deploy: measure handle-holder count (GO if <100k).
- [ ] Post-deploy: `handle_history_public` default is catalog-stored (`pg_attribute.atthasmissing=true`, no rewrite).
- [ ] Post-deploy: table + `IDX_handle_history_user_created` + trigger `trg_handle_history_no_update` exist.
- [ ] Post-deploy: a throwaway `UPDATE handle_history` raises `append-only`.
- [ ] Post-deploy: backfill row count == live handle-holders; zero holders missing; `handle_canonical = lower(handle)` for all rows.
- [ ] Rollback exports `handle_history` first; `down()` prod-guarded.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (deployment-verification-agent).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
