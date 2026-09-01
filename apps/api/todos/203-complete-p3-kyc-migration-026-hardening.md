---
status: complete
priority: p3
issue_id: 203
tags: [code-review, migration, database, kyc, TOV-29, PR-31]
dependencies: []
---

# Migration 1716000000026 hardening: down() `approved` remap, txn-dependency comment, `lock_timeout` caveat, verification SQL

## Problem Statement
The migration is safe under the repo's sanctioned commands (`migration:run -t each` → per-migration
transaction, confirmed in `data-source.ts:16` + `setup-test-db.sh:85`); `up()` ordering (add columns →
drop CHECK → backfill → add NOT VALID → VALIDATE) is correct, and the rolling-deploy "no new-vocabulary
rows in Phase 0" claim is accurate against `kyc.service.ts` (only `pending_review` is ever written at the
user level). A cluster of small robustness/documentation items remain — none blocks a forward deploy.

## Findings
- **down() fabricates a synthetic `approved`** — `1716000000026:61` `UPDATE users SET kyc_status='approved' WHERE kyc_status='whitelisted'`. No user was ever `approved` at the user level (that state was never written pre-M12); a real down() after M12 manufactures a review outcome that never happened. `frozen`/`removed → not_submitted` (lossy) is already acknowledged. (data-migration P2.)
- **down()'s constraint-less window** — `:60-69` drops the CHECK before re-adding it; safe only because `undoLastMigration` wraps down() in a transaction (verified in TypeORM `MigrationExecutor`), but the file's up() header warns about exactly this for up() and never states down() shares the invariant. (data-migration P2.)
- **`SET LOCAL lock_timeout`** (`:30,:59`) is a silent no-op if ever run under `-t none` (outside a txn). Works under the pinned `each` mode; first migration in the repo to use it, so no house precedent documents the dependency. (data-migration P3.)
- **Forward re-run asymmetry** — up() uses bare `ADD COLUMN` / `DROP CONSTRAINT` (no `IF [NOT] EXISTS`) while down() uses `DROP COLUMN IF EXISTS`. Safe under transactional runs; cosmetic. (data-migration P3.)
- **Verification SQL gap** — the plan's post-deploy SQL selects `is_nullable` but doesn't state the expected value, and never verifies the column DEFAULT `'not_submitted'` still satisfies the new CHECK. (data-migration P3.)

## Proposed Solutions
### Option A (recommended): comments + down() fold, no behavior change to up()
- Change down() `whitelisted → not_submitted` (honest "prior review outcome unknown"), OR keep `approved` but add a header note that it is a **synthetic placeholder**, not a real prior state.
- Add a down() comment mirroring the up() header: "shares the revert transaction — never run under `-t none`."
- Add a one-line note that `SET LOCAL lock_timeout` relies on the `-t each`/transactional mode.
- Tighten the plan's verification SQL: `-- is_nullable expect YES,YES` and a post-deploy insert of a default-status row to prove the DEFAULT still validates.

**Effort: Small (comments + one UPDATE change).**

## Recommended Action
**RESOLVED (Option A — comments + verification SQL; kept the `approved` remap).** Decided to KEEP down()'s
`whitelisted → approved` because it is the exact inverse of up()'s `approved → whitelisted` (so up→down→up
round-trips cleanly); folding to `not_submitted` would break that round-trip. Instead documented it inline as
a deliberate inverse, NOT a claim about real history. Added a down() comment noting it shares the revert
transaction (never `-t none`), extended the `SET LOCAL lock_timeout` comment with the `-t each` dependency,
and tightened the plan's post-deploy verification SQL (`is_nullable=YES` expectation + a `column_default`
check that `'not_submitted'` still satisfies the new CHECK). The up() `IF [NOT] EXISTS` asymmetry is left as
cosmetic (safe under the transactional run mode).

## Technical Details
- Affected: `src/database/migrations/1716000000026-EvolveKycWhitelistStatus.ts`; plan verification SQL in `docs/plans/2026-07-17-feat-kyc-whitelist-status-read-endpoint-plan.md`.

## Acceptance Criteria
- [ ] down() either folds `whitelisted → not_submitted` or documents `approved` as synthetic.
- [ ] down() notes its dependency on the revert transaction; `lock_timeout`'s `-t each` dependency is noted.
- [ ] Verification SQL states expected `is_nullable` and checks the column DEFAULT against the new CHECK.

## Work Log
- 2026-07-17: Filed from PR #31 review (data-migration-expert P2/P3, performance-oracle P3). No code changed.
- 2026-07-17: RESOLVED. Comment-only hardening in migration 1716000000026 + verification SQL tweak in the plan. build/lint green. Status → complete.
