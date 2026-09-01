---
status: complete
priority: p2
issue_id: 168
tags: [code-review, data-integrity, handle, users, soft-delete, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (document now). Added a ⚠️ **RESTORE INVARIANT** note to the migration header
(`src/database/migrations/1716000000023-AddUsersHandle.ts`) and a "Handle restore invariant (TOV-26)"
paragraph to `src/modules/users/CLAUDE.md` (Soft Delete section). Both state that the partial index
releases a soft-deleted collector's handle, so any future restore/undelete path may 23505 on a write
OUTSIDE `HandleService.setHandle`'s catch (raw 500) and MUST clear/rename `handle` on restore (or catch
23505 and force re-selection). No behavior change; the landmine is now signposted for the future restore
feature. Chose Option A over Option B (null-out-on-delete) since whether a restored user keeps their
handle is a product decision to make when a restore path is actually built.

# Restore/undelete of a soft-deleted user can 23505 outside `setHandle`'s catch (undocumented in code)

## Problem Statement
The handle uniqueness partial index `UQ_users_handle_canonical_active` excludes soft-deleted rows
(`WHERE handle_canonical IS NOT NULL AND deleted_at IS NULL`). This intentionally releases a
soft-deleted collector's handle for reuse (AC15). The reachable-but-unhandled sequence:

1. User A claims `maya` (live row, canonical indexed).
2. User A is soft-deleted → row leaves the index.
3. User B claims `maya` → succeeds.
4. User A is later **restored** (`deleted_at → NULL`) → A's `maya` re-enters the index against B's
   live `maya` → **23505**.

There is no user-restore path today, so this is not currently reachable. But the 23505 would fire on
a *different* write path than `setHandle`, so it escapes `handle.service.ts`'s try/catch entirely and
surfaces via `AllExceptionsFilter` as a generic **500**. The plan captured this as AC16, but the
shipped code and `users/CLAUDE.md` do **not** document it — so whoever adds `restore()`/admin-undelete
later has no signpost.

## Findings
- `src/database/migrations/1716000000023-AddUsersHandle.ts:39-43` — partial index excludes soft-deleted rows.
- `src/modules/users/handle/handle.service.ts:44-49` — 23505 is only caught for the `setHandle` write.
- No restore/undelete path exists in `src/modules/users` or `BaseRepository` (confirmed by two agents).
- Documented as AC16 in `docs/plans/2026-07-15-feat-collector-handle-uniqueness-plan.md` but not in code.

## Proposed Solutions
### Option A: Document the invariant now (recommended)
- Add a one-line note to the migration header and `src/modules/users/CLAUDE.md`: "Restoring a
  soft-deleted user may raise 23505 on `handle_canonical` if the handle was re-claimed while deleted;
  any future restore path must clear/rename `handle` or handle 23505."
- **Pros:** zero behavior change; signposts the landmine for the future restore feature. **Cons:** doesn't
  prevent the 500 if someone ignores the note. **Effort: Small.**

### Option B: Null out `handle` on user soft-delete
- In `UsersService.softDelete()`, also set `handle = null` so a deleted user's handle is released at
  delete time and restore can never collide.
- **Pros:** removes the collision class entirely. **Cons:** product decision (does a restored user lose
  their handle?); touches the delete path; a restored user must re-pick. **Effort: Medium.**

### Option C: Guard restore when it ships
- Defer entirely; require the future restore PR to catch 23505 and clear/rename the handle.
- **Pros:** no work now. **Cons:** relies on a future author remembering. **Effort: None now.**

## Recommended Action
_(triage — Option A is cheap and closes the documentation gap without a product decision)_

## Technical Details
- Files: `src/database/migrations/1716000000023-AddUsersHandle.ts`, `src/modules/users/CLAUDE.md`
  (Option A); `src/modules/users/users.service.ts` (Option B).

## Acceptance Criteria
- [ ] The restore/23505 interaction is documented in code (migration header and/or users/CLAUDE.md), OR
- [ ] User soft-delete nulls the handle, with a test proving restore-then-reclaim cannot 23505.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (data-integrity-guardian). Not reachable today
  (no restore path); P2 because a future restore feature will hit an unhandled 500.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
- Plan AC16: `docs/plans/2026-07-15-feat-collector-handle-uniqueness-plan.md`
