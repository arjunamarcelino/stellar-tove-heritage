---
status: complete
priority: p2
issue_id: 219
tags: [code-review, migration, database, TOV-233, PR-32]
dependencies: []
---

# Migration 027 relaxes the audit CHECK on a populated append-only table without NOT VALID→VALIDATE/lock_timeout, and down() re-adds it without 'admin'

## Problem Statement
Migration 027 rewrites the `internal_audit_log` actor_type CHECK with a bare DROP + ADD (no NOT VALID, no lock_timeout guard) on a prod-populated append-only table, breaking the documented house convention. Its `down()` re-adds the CHECK without 'admin', which cannot be revalidated once this PR has written admin audit rows.

## Findings
- `src/database/migrations/1716000000027-CreateArtworksTable.ts` ~lines 57-63 do a bare `DROP CONSTRAINT` + `ADD CONSTRAINT ... CHECK (...)` (no NOT VALID) on the existing prod-populated `internal_audit_log` → ACCESS EXCLUSIVE + a validating full-table scan under that lock, and no `SET LOCAL lock_timeout` guard.
- This breaks the documented house convention followed in `1716000000026-EvolveKycWhitelistStatus.ts` ~lines 32, 38-47 (`SET LOCAL lock_timeout='3s'` + ADD CONSTRAINT NOT VALID then VALIDATE, comment cites convention …025).
- Since only 'admin' is ADDED (widening), every existing row satisfies the new predicate → VALIDATE cannot fail → the split is pure upside.
- `down()` ~lines 107-113 re-adds the CHECK with only ('user','system'); but this PR writes `actor_type='admin'` rows (`backoffice-artworks.service.ts` ~line 126) and `internal_audit_log` is append-only (migrations 015/017: no UPDATE/DELETE) → a non-prod revert after any admin audit row exists FAILS the validating ADD CONSTRAINT and cannot be unblocked by deleting rows.

## Proposed Solutions
### Option A (recommended): follow the house convention in both directions
- Use `SET LOCAL lock_timeout` + `ADD CONSTRAINT NOT VALID` + `VALIDATE` in `up()`.
- In `down()`, re-add as NOT VALID (tolerate pre-existing admin rows) or skip VALIDATE, and document that reverting 027 requires an admin-free audit log.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A).** up() now wraps the audit-CHECK swap in `SET LOCAL lock_timeout = '3s'` and uses `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT` (house convention …025/…026), so the validating scan runs under SHARE UPDATE EXCLUSIVE instead of holding ACCESS EXCLUSIVE across a full-table scan; since the change only widens the set (adds 'admin'), VALIDATE cannot fail. down() re-narrows to ('user','system') as `NOT VALID` (append-only table → existing 'admin' rows can't be deleted to satisfy a validating re-add), installing the constraint for future writes while tolerating pre-existing rows — a non-prod revert no longer fails on an admin audit row.

## Technical Details
- Affected: `src/database/migrations/1716000000027-CreateArtworksTable.ts` (~lines 57-63 up, ~lines 107-113 down).
- Precedent: `src/database/migrations/1716000000026-EvolveKycWhitelistStatus.ts` (~lines 32, 38-47).
- `internal_audit_log` is append-only per migrations 015/017; admin rows written by `backoffice-artworks.service.ts` ~line 126.

## Acceptance Criteria
- [ ] `up()` uses `SET LOCAL lock_timeout` + `ADD CONSTRAINT NOT VALID` + `VALIDATE`.
- [ ] `down()` does not fail on a table containing `actor_type='admin'` rows.
- [ ] Revert prerequisite (admin-free audit log, or NOT VALID re-add) is documented inline.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — NOT VALID/VALIDATE + lock_timeout in up(); down() re-adds NOT VALID; build green.
