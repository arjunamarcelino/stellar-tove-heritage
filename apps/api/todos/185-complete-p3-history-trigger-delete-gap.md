---
status: complete
priority: p3
issue_id: 185
tags: [code-review, data-integrity, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option B (accurate comment). Reworded the migration `…024` comments to state the trigger provides
UPDATE-immutability only — rows are un-EDITABLE but NOT un-DELETABLE (an ad-hoc `DELETE` by the app role is
still permitted, a deliberately weaker guarantee than `internal_audit_log` so the FK `ON DELETE CASCADE`
GDPR-erase keeps working). Documented the hardening path inline: `REVOKE DELETE ON handle_history FROM
<app_role>` if tamper-evident deletion is ever required (CASCADE bypasses the child DELETE privilege). No DDL
change (trigger scope intentionally unchanged), so no re-migration; the `BEFORE UPDATE`-only scope remains
correct for the current own-service-writer threat model. Option A (REVOKE) deferred — needs the per-env app
role name and isn't warranted today.

## Problem Statement
The `handle_history` immutability trigger is `BEFORE UPDATE` only — correctly scoped so the FK
`ON DELETE CASCADE` (GDPR erase) still fires. But a direct `DELETE FROM handle_history` by the app role
is permitted, so the ledger is immutable against edits but NOT against targeted row deletion outside the
CASCADE path — a weaker guarantee than `internal_audit_log` (which blocks `UPDATE OR DELETE`). The
migration comment "makes history immutable" overstates it (only UPDATE is blocked).

## Findings
- `src/database/migrations/1716000000024-CreateHandleHistory.ts:59-71` — `BEFORE UPDATE` trigger.
- Compare `src/database/migrations/1716000000017-EnforceAuditLogAppendOnly.ts` — `BEFORE UPDATE OR DELETE`.

## Proposed Solutions
### Option A: `REVOKE DELETE ON handle_history FROM <app_role>`
- **Pros:** CASCADE deletes run as the parent-table operation and bypass the child DELETE privilege
  check, so GDPR erase still works while ad-hoc DELETE is blocked. **Cons:** needs the app role name.
  **Effort: Small.**

### Option B: Keep as-is; soften the migration comment
- **Pros:** own-service-writer threat model accepts DELETE. **Cons:** no tamper-evidence against row
  deletion. Comment becomes "blocks UPDATE". **Effort: Small.**

## Recommended Action
_(triage — Option B (fix the comment) unless tamper-evidence is required, then Option A.)_

## Technical Details
- Files: `src/database/migrations/1716000000024-CreateHandleHistory.ts` (comment; optionally a REVOKE).

## Acceptance Criteria
- [x] The comment accurately reflects the guarantee (UPDATE-blocked, DELETE-allowed) + documents the REVOKE hardening path. (Hardening deferred — not required today.)

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (data-integrity-guardian).
- 2026-07-15: Resolved (Option B) — accurate migration comments; REVOKE DELETE hardening documented as the escalation.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
