---
status: complete
priority: p2
issue_id: 310
tags: [code-review, deployment, operations, database, tov-158]
dependencies: []
---
# Add TOV-158 deploy runbook section: pre-deploy migration pin + cancel-surface monitoring

## Problem Statement
Migration `1716000000037` is an `ALTER` on the `offering_bids` money table that, under `migrationsTransactionMode:'each'`, opens with an ACCESS-EXCLUSIVE `ADD COLUMN` held for the whole transaction (covering the two non-CONCURRENT unique-index rebuilds + VALIDATEs). With `migrationsRun` defaulting true, a rolling multi-replica deploy races the migration → losing replicas hit `lock_timeout='3s'` → boot failure/crashloop. The existing TOV-156 runbook does not yet cover `…037`, and the new cancel surface introduces stuck-`canceling` risk with no reconciler.

## Findings
- `src/config/database.config.ts` — `migrationsRun: DB_MIGRATIONS_RUN !== 'false'` (auto-run defaults on).
- `src/database/data-source.ts` — `migrationsTransactionMode: 'each'` (whole migration is one txn; the initial `ADD COLUMN` lock is held throughout).
- `src/database/migrations/1716000000037-AddOfferingBidCancelStates.ts` — the header's "still serve bid traffic" framing is partly illusory: all statements run under the inherited ACCESS EXCLUSIVE, so bid reads/writes block for the migration's duration (milliseconds on today's small table; scales with row count).
- No reconciler by design: a stuck `canceling` row = frozen escrowed USDC + held slot; the self-heal depends on the retry budget reaching an `expired` submit (see todo 312).
- `docs/solutions/deployment-issues/2026-08-20-tov156-offering-bids-deploy-runbook.md` — has no TOV-158 section.

## Proposed Solutions
### Option A — Append a TOV-158 section to the existing runbook (recommended)
- Description: Document (1) pre-deploy: pin app instances `DB_MIGRATIONS_RUN=false`, run `yarn migration:run` out-of-band, run in a low-traffic window; (2) post-deploy verification SQL (037 recorded; CHK_bid_status widened + convalidated; refund columns; guard fn carries `canceling`; split index predicates; new btree); (3) rollback = redeploy prior image, LEAVE `…037` applied (superset schema; `migration:revert` is prod-refused/fail-closed); (4) monitoring alerts (below).
- Pros: Mirrors the proven 036 runbook shape; captures the required compensating controls in one place.
- Cons: Doc-only; relies on operators following it.
- Effort: Small
- Risk: Low

### Option B — Also make migrations non-auto-run by default in prod config
- Description: Beyond the doc, change deploy config so migrations never auto-run on app boot.
- Pros: Removes the multi-replica race structurally.
- Cons: Broader change affecting all migrations; out of scope for this PR.
- Effort: Medium
- Risk: Medium

## Recommended Action
Option A — append a TOV-158 section to the existing runbook (doc-only; the multi-replica race is mitigated by following it).

## Technical Details
**Required monitoring alerts (arm before opening cancel traffic):**
- Stuck `canceling` (page): `SELECT count(*) FROM offering_bids WHERE status='canceling' AND deleted_at IS NULL AND updated_at < now() - interval '15 minutes'` > 0.
- Terminal-but-unstamped (corruption backstop): `SELECT count(*) FROM offering_bids WHERE status='canceled' AND (refund_tx_hash IS NULL OR canceled_at IS NULL)` must be 0.
- `offering-bid-cancel` queue depth/failed count (shares the `relayer:account` lock with escrow → joint ~0.2 tx/s SLO).
- `offering.bid.cancel_failed` audit-rate spike; "bid cancel enqueue failed … reverting to escrowed" log; relayer XLM balance.

## Acceptance Criteria
- Runbook has a TOV-158 section with the pre-deploy pin, verification SQL, rollback note, and the alert queries above.
- The migration docstring's "still serve bid traffic" claim is softened to note the brief full-table exclusive lock / low-traffic-window guidance (overlaps todo 313).

## Work Log
- 2026-08-20: created from PR #42 deployment-verification-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42
- Runbook: `docs/solutions/deployment-issues/2026-08-20-tov156-offering-bids-deploy-runbook.md`

---

## Resolution (COMPLETE — 2026-08-20)
Appended a "TOV-158 cancel/refund — Deployment Addendum" to
`docs/solutions/deployment-issues/2026-08-20-tov156-offering-bids-deploy-runbook.md` (§7-§10 + a manual-recovery
section) covering: the pre-deploy migration pin (`DB_MIGRATIONS_RUN=false`, low-traffic window) that defeats the
multi-replica ACCESS-EXCLUSIVE boot race; post-deploy verification SQL (widened CHECK/refund belts/guard-fn/split
indexes/reordered btree); the mainnet double-cancel live-testnet gate (todo 311); the rollback posture (redeploy
prior image, leave 037 applied; revert is prod-refused); the required cancel-surface monitoring alerts
(stuck-`canceling` page > 15 min, terminal-unstamped corruption backstop, queue depth, cancel_failed spike,
enqueue-revert log, relayer XLM); and a manual-recovery procedure for a stranded `canceling` row. Doc-only.
