---
status: complete
priority: p2
issue_id: 170
tags: [code-review, deployment, database, migration, handle, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (documented Go/No-Go gate). Created a deploy runbook at
`docs/solutions/deployment-issues/2026-07-15-add-users-handle-migration-deploy-gate.md` capturing: the
3-statement lock profile, the pre-deploy size gate (GATE 1 est_rows/size, GATE 2 columns-absent, GATE 3
no long txns), writer-drain requirement, deploy steps, post-deploy verification SQL, fail-closed rollback
(redeploy prior image — do NOT `migration:revert`), the large-table split path (Option B), and 24h
monitoring signals. The migration header already documents the lock profile; this adds the executable
runbook ops runs at deploy time. Option B (split into rewrite-free migrations) is documented as the
fallback for when GATE 1 fails — not needed at current early-stage `users` size.

# Deploy gate: `AddUsersHandle` rewrites the `users` table under ACCESS EXCLUSIVE — verify table size before prod run

## Problem Statement
Migration `1716000000023-AddUsersHandle` runs three DDL statements in one TypeORM transaction. Step 2,
`ADD COLUMN handle_canonical text GENERATED ALWAYS AS (lower(handle)) STORED`, forces a **full table
rewrite of `users` under `ACCESS EXCLUSIVE`** (no `NOT NULL DEFAULT` fast path exists for STORED
generated columns). Step 3's plain `CREATE UNIQUE INDEX` adds a `SHARE` lock, serialized in the same
transaction. For the whole migration, **all reads and writes to `users` block** — login, register,
SEP-10, and every JWT-authenticated request that touches `users`.

The migration comment explicitly accepts this "at the current `users` size (early-stage)", but there is
**no programmatic size assertion** — nothing prevents it running against a table that has since grown,
which would turn the deploy into an outage. This is a deploy-time gate, not a code defect (the migration
is correctly written and self-documents the risk).

## Findings
- `src/database/migrations/1716000000023-AddUsersHandle.ts:9-15,30-43` — lock profile documented, no size guard.
- `Dockerfile` bakes `NODE_ENV=production`; migration runs via `yarn migration:run` (one txn per migration).
- `down()` is fail-closed in prod — `migration:revert` is NOT a rollback path (see Rollback below).
- Connection pool max 20 — blocked writers can saturate it and cascade to 5xx if writers aren't drained.

## Proposed Solutions
### Option A: Pre-deploy Go/No-Go size gate (recommended)
Before running in prod, verify `users` is still early-stage small:
```sql
SELECT reltuples::bigint AS est_rows, pg_size_pretty(pg_total_relation_size('users')) AS total_size
FROM pg_class WHERE relname = 'users';   -- GO if small (e.g. < ~100k rows / < ~100 MB); else NO-GO.
```
Also: confirm columns don't already exist; confirm no long-running txns holding locks; drain/quiesce
writers (maintenance window or migrate-before-traffic). **Pros:** catches the one real risk. **Cons:**
manual gate. **Effort: Small.**

### Option B: Split into rewrite-free migrations (only if GATE fails / table is large)
- (1) plain nullable `handle_canonical text` + batched backfill of `lower(handle)` + sync trigger;
  (2) separate `transaction = false` migration with `CREATE UNIQUE INDEX CONCURRENTLY`.
- **Pros:** no ACCESS EXCLUSIVE rewrite. **Cons:** more migrations + a trigger; only needed at scale.
  **Effort: Large.**

## Recommended Action
_(triage — Option A is mandatory before prod deploy; Option B only if the size gate fails)_

## Technical Details
- Rollback: redeploy the prior app image and LEAVE the columns (additive + nullable, old code ignores
  them). Do NOT `migration:revert` in prod (fail-closed; dropping `handle` destroys collector identities).
- Post-deploy verify: migration row recorded; `handle_canonical` is `is_generated=ALWAYS`, expr `lower(handle)`;
  partial index present with exact predicate; `count(*)` unchanged; two rapid POSTs of same handle → one 200,
  one 409.

## Acceptance Criteria
- [ ] Go/No-Go size gate executed against prod `users` before the migration runs, result recorded.
- [ ] Writers to `users` drained/quiesced during the migration window.
- [ ] Post-deploy verification queries pass; rollback plan (redeploy prior image) confirmed.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (deployment-verification-agent). GO only if the
  size gate confirms early-stage size; else NO-GO and split per Option B.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
- Precedent: `src/database/migrations/1716000000020-AddWalletsIsPrimary.ts` (same lock-accepted-at-size pattern)
