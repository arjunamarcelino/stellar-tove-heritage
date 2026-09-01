---
status: complete
priority: p2
issue_id: 324
tags: [code-review, deployment, database, tov-160]
dependencies: []
---
# No TOV-160 deploy runbook / post-deploy verification SQL ships with the settlement money-table migration

## Problem Statement
PR #43 adds migrations `038` (transactional settlement half — `offering_clearing_audit` + `offering_bids` won/lost widening + `offerings` failure columns) and `039` (`CREATE INDEX CONCURRENTLY` on the clearing walk), but ships NO deploy runbook and NO post-deploy verification SQL. This breaks the precedent set for the sibling money migration on the same subtree: commit `52a6a45` "docs(deploy): add TOV-158 cancel/refund runbook + monitoring addendum". Migration `038` takes `ACCESS EXCLUSIVE` on BOTH `offering_bids` AND `offerings` for the whole transaction (the `ADD COLUMN`s hold to COMMIT), so bid reads/writes block for `038`'s duration — exactly the hazard `037`'s docstring flags ("run in a LOW-TRAFFIC WINDOW as a pre-deploy step"). `038`'s docstring documents only the FK-split rationale (why the `CONCURRENTLY` index is carved into `039`) and omits the low-traffic / `DB_MIGRATIONS_RUN=false` pre-step guidance, and there is no verification SQL for on-call to confirm the schema landed correctly on a money table.

## Findings
- `src/database/migrations/1716000000038-AddOfferingClearingAudit.ts:1-37` — the docstring documents the FK-lock split rationale and the fail-closed `down()`, but says nothing about running as a low-traffic pre-deploy step or `DB_MIGRATIONS_RUN=false`; it `SET lock_timeout = '3s'` at the top of `up()` (line 42) but never RESETs it (see 318).
- `src/database/migrations/1716000000039-AddOfferingBidsClearingIndex.ts` — the `CREATE INDEX CONCURRENTLY` (`transaction:false`) half; needs its own ordering note (`038` before `039`) and an `indisvalid` post-check (a `CONCURRENTLY` build can fail and leave an INVALID index).
- Precedent that is missing here: `docs/solutions/deployment-issues/2026-08-20-tov156-offering-bids-deploy-runbook.md` (TOV-156) and commit `52a6a45` (TOV-158 runbook + monitoring). No `docs/solutions/deployment-issues/*tov160*` file exists.
- `038` holds `ACCESS EXCLUSIVE` on `offerings` and `offering_bids` for the whole txn (multiple `ADD COLUMN` + `CHK` widen + trigger replace) — bid submit/cancel/read all block for its duration.

## Proposed Solutions
### Option A — Add a `docs/solutions/deployment-issues/` TOV-160 runbook + post-deploy verification SQL
- Description: Author `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` mirroring the TOV-158 runbook shape: pre-deploy `DB_MIGRATIONS_RUN=false` (run `038`→`039` as a controlled step, not on app boot), explicit `038`-before-`039` ordering, a low-traffic-window callout (ACCESS EXCLUSIVE on `offering_bids` + `offerings`), a `RESET lock_timeout` note (cross-ref 318), plus post-deploy verification SQL: `won`/`lost` present in `CHK_bid_status` (via `\d offering_bids`); `SELECT indisvalid FROM pg_index` for `IDX_offering_bids_clearing` = `true`; `SELECT count(*) FROM offering_clearing_audit`; the settlement FK `confdeltype = 'r'` (RESTRICT); the append-only trigger present on `offering_clearing_audit`.
- Pros: Restores the established money-migration deploy discipline; gives on-call copy-paste verification queries; documents the block-window so the deploy is scheduled, not surprised by it.
- Cons: Docs-only, no code change — relies on the deployer actually following it; slight duplication with the migration docstrings.
- Effort: Small
- Risk: Low

### Option B — Fold the guidance into the migration docstrings only
- Description: Extend `038`/`039` docstrings with the low-traffic / `DB_MIGRATIONS_RUN=false` / ordering notes and inline the verification queries as comments, skipping a standalone runbook.
- Pros: Guidance lives next to the code; no new doc file to keep in sync.
- Cons: Breaks the `docs/solutions/deployment-issues/` precedent on-call knows to look in; verification SQL buried in a `.ts` comment is not where an operator runs a deploy from; harder to attach a monitoring addendum.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — add a `docs/solutions/deployment-issues/` TOV-160 settlement runbook mirroring the TOV-158 precedent (`52a6a45`): pre-deploy `DB_MIGRATIONS_RUN=false`, `038`→`039` ordering, low-traffic window (ACCESS EXCLUSIVE on `offering_bids` + `offerings`), a `RESET lock_timeout` note (see 318), and the post-deploy verification SQL block. Related: 318 (lock_timeout not reset).

## Technical Details
Verification SQL to include:
- won/lost terminals: `\d offering_bids` shows `won`/`lost` in `CHK_bid_status`.
- `CONCURRENTLY` index validity: `SELECT indisvalid FROM pg_index WHERE indexrelid = 'IDX_offering_bids_clearing'::regclass;` must be `true` (an invalid index silently degrades the clearing-walk scan to a seqscan/sort).
- audit table reachable: `SELECT count(*) FROM offering_clearing_audit;` (expect 0 pre-first-settle, no error).
- settlement FK delete rule: the audit→offerings FK has `confdeltype = 'r'` (RESTRICT — retention).
- append-only trigger present on `offering_clearing_audit` (distinct trigger name, not colliding with `034`'s `fn_offering_approvals_append_only`).
Ordering: `038` (transactional) MUST land before `039` (`CONCURRENTLY`, `transaction:false`); the split exists precisely so a minutes-long index build never shares a txn with the FK's `ShareRowExclusive` on `offerings`.

## Acceptance Criteria
- A `docs/solutions/deployment-issues/` TOV-160 runbook exists covering: `DB_MIGRATIONS_RUN=false` pre-deploy, `038`→`039` ordering, low-traffic window rationale (ACCESS EXCLUSIVE on both money tables), and the `RESET lock_timeout` note (cross-ref 318).
- The runbook includes copy-paste post-deploy verification SQL for: `CHK_bid_status` won/lost, `IDX_offering_bids_clearing` `indisvalid = true`, `offering_clearing_audit` reachability, the FK `confdeltype = 'r'`, and the append-only trigger presence.
- On-call can run the deploy and confirm success without reading migration source.

## Work Log
- 2026-08-20: created from PR #43 [data-migration-expert] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Added `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` (mirrors the TOV-156/158
runbooks): strict 038-before-039 pre-deploy ordering with `DB_MIGRATIONS_RUN=false` in a low-traffic window +
the pg_stat_activity pre-check, the ACCESS-EXCLUSIVE / lock_timeout=55P03-retry note, post-deploy verification
SQL (both migrations recorded, won/lost in CHK_bid_status, index indisvalid=true, FK confdeltype='r', trigger,
no-Sort EXPLAIN), config prerequisites (measure OFFERING_MAX_BIDS_PER_OFFERING cliff, chain-gate note),
forward-only prod rollback, monitoring/alert SQL (stuck-subscribed + terminally-failed), and the #325 SLO note.
