---
status: complete
priority: p3
issue_id: 034
tags: [code-review, code-quality, dry]
dependencies: []
---

# Extract Last-Superadmin Check Into Private Helper

## Problem Statement
The last-superadmin protection check is duplicated between `update()` and `softDelete()` in `AdminsService`. Both methods have identical logic: check if admin is superadmin, count superadmins, throw if count <= 1.

## Findings
- `src/modules/backoffice/admins.service.ts` - both `update()` and `softDelete()` have the same check-then-throw pattern
- Logic: `if (admin.role === SUPERADMIN) { count = await repo.count({...}); if (count <= 1) throw BadRequest }`

## Proposed Solutions

### Option A: Extract to private method (ALREADY DONE)
- **Description:** Create `private async ensureNotLastSuperadmin(admin: Admin): Promise<void>` that encapsulates the check. Both `update()` and `softDelete()` call it.
- **Pros:** DRY; single place to modify protection logic; cleaner methods
- **Cons:** One more method (trivial)
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Already resolved during P1 fix 025.

## Technical Details
- **Affected files:** `src/modules/backoffice/admins.service.ts`
- **Components:** AdminsService

## Acceptance Criteria
- [x] Superadmin protection logic exists in one place
- [x] Both update and softDelete use the shared helper

## Work Log
- 2026-05-21: Created from PR #2 code review (Simplicity reviewer, Pattern recognition)
- 2026-05-21: Resolved — already extracted as `ensureNotLastSuperadmin()` private method with pessimistic locking during P1 fix 025. No additional changes needed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
