---
status: complete
priority: p2
issue_id: 261
tags: [code-review, migration, deployment, data-integrity, TOV-152, PR-36]
dependencies: []
---

# `down()` production guard fails OPEN when NODE_ENV is unset in the revert shell

## Problem Statement
The only protection against dropping this money-adjacent table on rollback is `if (process.env.NODE_ENV === 'production') throw`. But `yarn migration:revert` runs via the standalone `typeorm` CLI → `data-source.ts`, which calls `dotenv.config()` and does **NOT** run the Nest/Joi env validation (that only executes inside the app bootstrap). So the Joi `NODE_ENV` default of `'production'` never applies to a revert. If an operator runs `yarn migration:revert` against a prod DB from a shell where `NODE_ENV` is unset, the guard silently evaluates false and drops the `offerings` table (price band, window, public-float snapshot).

## Findings
Flagged by **data-migration-expert (P2)**. Same guard shape as the precedent migration 028, so this is a systemic pattern worth hardening (not unique to this PR).
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts` — `down()` guard.
- `src/database/data-source.ts` — `dotenv.config()` only, no Joi validation.
- `src/config/validation-schema.ts` — the `NODE_ENV` default binds only inside the app, not the CLI.

## Proposed Solutions
1. **Fail closed** — throw unless `NODE_ENV` is *explicitly* one of `development`/`test` (treat unset/unknown as production). Effort: Small. Best safety.
2. Document in the deploy runbook that prod reverts must export `NODE_ENV=production`, and that the primary rollback control is "roll the deployment back, don't revert the migration" (the additive empty table is inert to older code). Effort: trivial. Weaker (relies on operator discipline).
3. Combine 1 + 2. Recommended.

## Recommended Action
**RESOLVED — Solution 1, applied to 032 AND 028 (user confirmed).** All three offerings/on-chain migration
`down()` guards now **fail closed**: they throw unless `NODE_ENV` is explicitly `development` or `test`
(so an unset/unknown env is treated as production), instead of only throwing on `=== 'production'`.
Applied to `1716000000032` (offerings), `1716000000028` (fraction_contracts), and `1716000000033`
(composite FK, written fail-closed from the start).

## Technical Details
- `src/database/migrations/1716000000032-CreateOfferingsTable.ts` `down()`.
- Systemic: `1716000000028` and any other money/on-chain migration use the same `=== 'production'` guard.

## Acceptance Criteria
- [x] `down()` refuses to run when `NODE_ENV` is unset/unknown (not only when it equals `'production'`) — for 032, 028, and 033.
- [x] Rollback guidance documented in each guard's message (prefer deployment rollback over migration revert).

## Work Log
- 2026-08-18: created from PR #36 review (data-migration-expert P2).
- 2026-08-18: RESOLVED — fail-closed `NODE_ENV` guard applied to migrations 032, 028, and 033. Build + lint green (down() paths aren't exercised by the test suites).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
