---
status: complete
priority: p1
issue_id: 025
tags: [code-review, security, data-integrity, race-condition]
dependencies: []
---

# TOCTOU Race Condition in Last-Superadmin Protection

## Problem Statement
The `AdminsService` has check-then-act patterns for preventing demotion/deletion of the last superadmin. Between the `count()` check and the `save()`/`softRemove()` action, another concurrent request could also pass the check, resulting in zero superadmins in the system.

## Findings
- `src/modules/backoffice/admins.service.ts` lines ~65-76 (update): checks `count({ where: { role: SUPERADMIN } })`, then proceeds to demote if count > 1. Two concurrent requests could both read count=2 and both demote.
- `src/modules/backoffice/admins.service.ts` lines ~89-97 (softDelete): same pattern - checks count, then deletes
- No transaction wrapping or row-level locking (`SELECT ... FOR UPDATE`) is used
- The existing `BaseRepository` has no `runInTransaction` support (noted in previous review todo 017)

## Proposed Solutions

### Option A: Wrap in serializable transaction with row locking
- **Description:** Use a TypeORM transaction with `SERIALIZABLE` isolation or `SELECT COUNT(*) ... FOR UPDATE` to lock superadmin rows during the check. This prevents concurrent modifications.
- **Pros:** Bulletproof; standard PostgreSQL pattern for check-then-act
- **Cons:** Slightly more complex; may need transaction helper in repository
- **Effort:** Medium
- **Risk:** Low

### Option B: Use a PostgreSQL advisory lock
- **Description:** Acquire a PostgreSQL advisory lock before the check-then-act sequence. Only one process can hold the lock at a time.
- **Pros:** Simple concept; works across transactions
- **Cons:** Must remember to release lock; advisory locks can be footguns if mismanaged
- **Effort:** Medium
- **Risk:** Medium

### Option C: Database constraint (CHECK constraint or trigger)
- **Description:** Add a database-level constraint that prevents the last superadmin from being deleted or having their role changed. This moves the protection to the database layer.
- **Pros:** Impossible to bypass from application code; strongest guarantee
- **Cons:** Complex to implement as CHECK constraint; trigger-based approach adds DB complexity; harder to return meaningful error messages
- **Effort:** Large
- **Risk:** Medium

## Recommended Action
Option A: Wrap in transaction with pessimistic row locking.

## Technical Details
- **Affected files:** `src/modules/backoffice/admins.service.ts`
- **Components:** AdminsService (update, softDelete methods)

## Acceptance Criteria
- [ ] Concurrent requests cannot result in zero superadmins
- [ ] Single superadmin cannot be demoted or deleted even under concurrent load
- [ ] Error message clearly indicates "cannot remove last superadmin"
- [ ] Integration test verifies concurrent protection (or at minimum, transaction isolation)

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel, Data integrity guardian, Performance oracle)
- 2026-05-21: Fixed via Option A. Both `update()` and `softDelete()` now use `runInTransaction()` with `pessimistic_write` lock (SELECT ... FOR UPDATE) on superadmin rows when performing superadmin demotion/deletion. Extracted shared `ensureNotLastSuperadmin()` helper. Updated unit tests with mock EntityManager + QueryBuilder chain. Commit: 98d26e3

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
