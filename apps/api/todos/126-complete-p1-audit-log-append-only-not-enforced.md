---
status: complete
priority: p1
issue_id: 126
tags: [code-review, data-integrity, security, compliance, export, TOV-40]
dependencies: []
---

# internal_audit_log append-only property is not enforced in the DB

## Problem Statement
`internal_audit_log` is documented as append-only (the entity deliberately omits `updated_at`/`deleted_at`), but nothing in the schema enforces immutability. The migration explicitly punts the `REVOKE UPDATE, DELETE` to "an ops step" because the app role name is environment-specific — and there is no evidence that step is tracked anywhere in-repo. The app role connects with full DML, so any code path (or a careless future migration) can silently UPDATE/DELETE audit rows. For an AML/audit ledger, append-only is a compliance control, and a control that lives only in a comment is effectively absent.

## Findings
- `src/database/migrations/1716000000015-AddInternalAuditLog.ts:5-8` — comment defers REVOKE to an untracked ops step.
- `src/modules/wallets/export/entities/internal-audit-log.entity.ts:4-9` — immutability signalled by omitting `updated_at`/`deleted_at`, but only at the ORM level.
- No follow-up migration, trigger, or runbook reference in the diff enforces it.

## Proposed Solutions

### Option A: BEFORE UPDATE OR DELETE trigger that RAISE EXCEPTION (role-agnostic)
- **Description:** Add to the same (or a new) migration a trigger function that raises on any UPDATE/DELETE, so immutability is a DB fact independent of role names.
- **Pros:** Role-agnostic; guaranteed; travels with the schema; testable in integration.
- **Cons:** Triggers are heavier than the codebase's usual style; blocks legitimate admin corrections (which for an audit ledger is the point).
- **Effort:** Small
- **Risk:** Low

### Option B: REVOKE UPDATE, DELETE resolved via current_user / a config parameter
- **Description:** Add a migration that REVOKEs on the actual app role (resolved dynamically) rather than skipping because the name is "environment-specific."
- **Pros:** Standard least-privilege approach.
- **Cons:** Still role-coupled; a superuser/migration role can bypass; more environment plumbing.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A — BEFORE UPDATE OR DELETE trigger (role-agnostic, confirmed with the owner).

## Implemented Solution
Added migration `1716000000017-EnforceAuditLogAppendOnly.ts`: a `internal_audit_log_immutable()`
trigger function that `RAISE EXCEPTION`s, wired to a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger
on `internal_audit_log`. Chosen over REVOKE because it does not depend on the environment-specific app
role name and cannot be bypassed by a role with DML. `down()` drops the trigger + function.

Note: `TRUNCATE` fires only BEFORE-TRUNCATE triggers (not row DELETE triggers), so existing test teardown
that TRUNCATEs the table is unaffected — verified by the full e2e/integration suites staying green.

Added integration coverage in
`test/integration/modules/wallets/export/wallet-export-constraints.integration.spec.ts`: inserts a row,
asserts UPDATE and DELETE both reject, asserts the row is intact afterward.

## Technical Details
Affected: `src/database/migrations/1716000000017-EnforceAuditLogAppendOnly.ts` (new);
`test/integration/modules/wallets/export/wallet-export-constraints.integration.spec.ts` (+1 test, +truncate).
Re-ran `yarn db:test:setup` to load migration 17.

## Acceptance Criteria
- [x] UPDATE and DELETE on `internal_audit_log` are rejected at the DB layer.
- [x] Integration test proves it.
- [x] No reliance on an untracked ops step.

## Work Log
- 2026-07-14: Filed from PR #25 review (data-integrity reviewer).
- 2026-07-15: Implemented Option A (append-only trigger migration + integration test). build + lint + 6 export-constraint integration tests green. Marked complete.
