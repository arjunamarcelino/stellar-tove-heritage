---
status: complete
priority: p2
issue_id: 162
tags: [code-review, audit, reliability, wallets, tov-25]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Confirmed fail-closed-on-audit is the intended semantics for primary changes and documented
it in the `MeWalletsService.setPrimary` doc comment: the audit row is written with the transaction `manager`,
so an audit failure propagates (generic 500) and rolls the swap back. This is safe because a primary change —
unlike the export money path — has no on-chain side effect, so refusing when audit can't be recorded keeps
the settlement audit trail gap-free. No behavior change.

# Confirm & document fail-closed audit semantics for primary changes

## Problem Statement
For primary changes, `AuditLogService.record` is called **with a manager** (transactional), so an audit-write
failure propagates and rolls back the whole swap (`src/modules/wallets/export/audit-log.service.ts:25-30`).
`me-wallets.service.ts` `setPrimary`/`remove` only catch `WalletMutationError`, so a non-mutation audit
failure surfaces as a generic HTTP 500 and the operation is refused. This is **fail-closed**: if audit writes
are failing (e.g. the append-only trigger, a DB hiccup), a user cannot set-primary or delete a primary wallet.

This differs from the export *money* path, which deliberately fails **open** on non-transactional audit
(logs, never throws) because an on-chain action already succeeded. For primary changes no on-chain action
occurs, so fail-closed is defensible — but it is an intentional availability trade-off that should be
confirmed and documented, not left implicit.

## Findings
- `audit-log.service.ts:25-30` — with `manager`, errors propagate (atomic); without, they are swallowed.
- `me-wallets.service.ts` — `setPrimary`/`remove` only map `WalletMutationError`; other errors → 500 (generic
  message via `AllExceptionsFilter`, no internal detail leaked).
- `internal_audit_log` is append-only (DB trigger), so a failing/again-failing audit write blocks the action.

## Proposed Solutions
### Option A (recommended): Confirm fail-closed is intended; document it
- Add a code comment at the `setPrimary`/`remove` orchestration and in the plan/solution docs stating that
  primary changes are fail-closed on audit (atomic; no on-chain side effect ⇒ safe to roll back), contrasting
  with the export money path.
- **Pros:** captures the deliberate decision; no behavior change. **Cons:** none. **Effort: Small.**

### Option B: Make primary-change audit fail-open
- Not recommended — a settlement-wallet audit trail with silent gaps undermines the audit's purpose; and
  there's no on-chain action forcing the operation to complete.

## Recommended Action
_(triage — expected: Option A)_

## Technical Details
- Files: `src/modules/wallets/me/me-wallets.service.ts`, `src/modules/wallets/export/audit-log.service.ts`.

## Acceptance Criteria
- [ ] The fail-closed-on-audit decision for primary changes is confirmed and documented (code + docs).

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (security-sentinel). No stack detail leaks (filter
  returns generic messages for non-HttpExceptions); the concern is availability semantics, not disclosure.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
