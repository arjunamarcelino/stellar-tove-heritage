---
status: complete
priority: p3
issue_id: 226
tags: [code-review, docs, quality, TOV-233, PR-32]
dependencies: []
---

# CAS-latch duplication + observability, and documentation/convention drift

## Problem Statement
Two CAS-latch code paths share a near-identical transaction skeleton (drift-prone as more transitions
appear), one divergence case is silent, and a spread of documentation/comment items have drifted from
the code they describe. All are low-risk housekeeping — the doc/comment fixes are trivial; the helper
extraction and divergence warning can wait for the next state transition.

## Findings
- **Triplicated CAS-latch skeleton** — `src/modules/fractionalization/fraction-deploy.processor.ts:95-138` (`latchDeployed` / `latchFailed`) and `src/modules/fractionalization/fraction-reconcile.processor.ts:47-67` (reconcile promote) share a near-identical `runInTransaction → casDeployed/casFailed → casStatus → audit.record` skeleton (3 copies, drift-prone). Extract a small `advanceArtwork(manager, {contractCas, artworkTo, auditKind, payload})` helper if a 4th transition appears.
- **Silent latch divergence** — `fraction-deploy.processor.ts` (`latchDeployed`): when `casDeployed` wins but the artwork `casStatus('fractionalizing'→'fractionalized')` affects 0 rows (artwork moved externally — currently unreachable given the soft-delete trigger), the derived-latch divergence is silent. Log a warning so it is observable.
- **Migration 028 trigger comment scope** — `src/database/migrations/*028*`: the comment says the BEFORE UPDATE trigger "guards soft-deletes" — true, but it does NOT fire on TRUNCATE (statement-level); the inbound FK `ON DELETE RESTRICT` covers hard-delete. Add a one-line comment that TRUNCATE is out of scope.
- **Docs drift** — the new `src/modules/fractionalization/` module is absent from `src/modules/CLAUDE.md` 'Current Modules' and the root `CLAUDE.md` architecture tree; `src/config/fraction-factory.config.ts` is absent from `src/config/CLAUDE.md` 'Files'; consider a per-module `src/modules/fractionalization/CLAUDE.md` (`auth/` and `users/` have one).
- **Migration 027 stale constraint name** — `src/database/migrations/*027*:~12`: the comment references `CHK_users_email_has_hash`, renamed to `CHK_users_password_needs_email` in migration 012. The seed is valid either way; the comment names a constraint that no longer exists.
- **`RetentionSumConstraint` coverage gap** — `src/modules/fractionalization/dto/fractionalize-artwork.dto.ts:42-49`: attached only to `artist_retention_pct` and reads both fields with `?? 0`. Add a targeted e2e (omit one field, set the other to 100) to confirm the sum ceiling can't be skipped; the DB `CHK_fc_pct` is the backstop.

## Proposed Solutions
### Option A: fix the docs/comments now, track the code items for the next transition
- Fix the doc/comment items now (trivial): migration 028 TRUNCATE note, migration 027 stale constraint name, and the CLAUDE.md docs drift (module tree + config file + optional per-module CLAUDE.md).
- Track the `advanceArtwork` helper extraction and the divergence warning for the next artwork transition.
- Add the targeted `RetentionSumConstraint` e2e alongside the other fractionalization suites.
- **Effort: Small.**

## Recommended Action
**RESOLVED (Option A — fixed the concrete items; tracked the rest).**
- (1) 3-copy CAS-advance-audit skeleton — LEFT as-is per the duplication>wrong-abstraction philosophy (the three differ in target status/artwork target/audit payload); a note remains to extract `advanceArtwork(...)` if a 4th transition appears.
- (2) silent divergence when `casDeployed` wins but the artwork advance affects 0 rows — FIXED: `latchDeployed` now captures the `casStatus` result and logs a warning (currently unreachable given the soft-delete trigger, but now observable).
- (3) migration 028 comment now documents that the soft-delete trigger does NOT fire on TRUNCATE (inbound FK covers hard-delete; TRUNCATE errors via the FK).
- (4) docs drift — FIXED: added a `fractionalization/` entry to `src/modules/CLAUDE.md` and `fraction-factory.config.ts` to `src/config/CLAUDE.md`. (A dedicated per-module `CLAUDE.md` is optional — the module-map paragraph now covers it.)
- (5) migration 027 comment corrected: the users email/hash CHECK is `CHK_users_password_needs_email` post-…012 (not the old `CHK_users_email_has_hash`).
- (6) `RetentionSumConstraint` single-field placement — the DB `CHK_fc_pct` is the authoritative backstop and the service also rejects `sum>100`; an e2e that omits one field lands with todo 224.

## Technical Details
- `src/modules/fractionalization/fraction-deploy.processor.ts:95-138`
- `src/modules/fractionalization/fraction-reconcile.processor.ts:47-67`
- `src/database/migrations/*028*` (trigger comment), `src/database/migrations/*027*:~12` (stale constraint name)
- `src/modules/CLAUDE.md`, root `CLAUDE.md`, `src/config/CLAUDE.md`; `src/config/fraction-factory.config.ts`
- `src/modules/fractionalization/dto/fractionalize-artwork.dto.ts:42-49`

## Acceptance Criteria
- [ ] Migration 028 comment notes TRUNCATE is out of scope; migration 027 comment names an existing constraint.
- [ ] `src/modules/fractionalization/` appears in the module docs; `fraction-factory.config.ts` appears in `src/config/CLAUDE.md`.
- [ ] The `advanceArtwork` helper extraction + silent-divergence warning are tracked for the next transition.
- [ ] A targeted `RetentionSumConstraint` e2e confirms the sum ceiling can't be skipped.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — divergence warning + migration comments + CLAUDE.md docs; build green.
