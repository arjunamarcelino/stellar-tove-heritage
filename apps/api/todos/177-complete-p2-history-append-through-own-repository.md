---
status: complete
priority: p2
issue_id: 177
tags: [code-review, architecture, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (mirror the `internal_audit_log` precedent). Added `record(userId, handle, manager?)` to
`IHandleHistoryRepository` + `HandleHistoryRepository` (uses `manager.getRepository(HandleHistory).insert`
when a transactional manager is passed, exactly like `InternalAuditLogRepository.record`). `UserRepository`
now `@Inject`s `HANDLE_HISTORY_REPOSITORY` and `setHandle` calls `this.handleHistory.record(userId, handle,
manager)` inside its transaction instead of a raw `manager.insert(HandleHistory, …)` — so the entity write
flows through its owning repository and no repository writes a foreign entity directly. The append stays
atomic with the `users.handle` UPDATE (shared manager). Registered the `HANDLE_HISTORY_REPOSITORY` provider in
the TOV-26 handle integration test module (UserRepository now depends on it). Kept the transaction in
`UserRepository` (it owns `runInTransaction`); the deeper Option B (move orchestration to `HandleService`)
was considered but not needed to satisfy the acceptance criteria and would have widened the `IUserRepository`
contract. Build clean; handle (13) + handle-history (10) integration + collectors e2e (9) green.

# handle_history append bypasses its own repository; diverges from the internal_audit_log precedent

## Problem Statement
The history append is a raw `manager.insert(HandleHistory, ...)` inlined inside `UserRepository.setHandle`.
UserRepository now writes a second entity it doesn't own, HandleHistoryRepository is read-only, and the
`IHandleHistoryRepository` abstraction + `HANDLE_HISTORY_REPOSITORY` token guard only reads. The codebase
already has the sanctioned pattern for "append atomically inside someone else's transaction":
`internal_audit_log`'s repository owns read+write via `record(entry, manager?)`. Also, the change-detection
business rule + cross-entity orchestration arguably belongs in `HandleService` (the orchestrator) rather
than a repository.

## Findings
- `src/modules/users/repositories/user.repository.ts:44-56` — inlined foreign-entity insert + orchestration.
- `src/modules/wallets/audit/repositories/internal-audit-log.repository.ts:23-33` — the `record(entry, manager?)` precedent.

## Proposed Solutions
### Option A: Add `record(entry, manager?)` to `IHandleHistoryRepository`
- **Pros:** mirrors the audit precedent; append flows through the entity's own repo; no foreign-entity write in UserRepository. **Cons:** slightly more surface on the history repo. **Effort: Medium.**

### Option B: Move transactional orchestration into `HandleService`
- **Pros:** business rule + cross-entity orchestration live in the orchestrator (using `UserRepository.runInTransaction`), calling entity-scoped repo methods. **Cons:** more moving parts across the service/repo seam. **Effort: Medium.**

### Option C: Keep as-is
- **Pros:** transaction is tightest at the DB seam. **Cons:** repository writes a foreign entity; deviates from the audit precedent. **Effort: None** (document the deviation).

## Recommended Action
_(triage — Option A: mirror the audit precedent.)_

## Technical Details
- Files: `src/modules/users/repositories/handle-history.repository.ts`, `handle-history-repository.interface.ts`, `user.repository.ts`, possibly `handle.service.ts`.

## Acceptance Criteria
- [x] History append flows through `IHandleHistoryRepository`; no repository writes a foreign entity directly; existing tests still green.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (architecture-strategist).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
