---
status: complete
priority: p2
issue_id: 030
tags: [code-review, data-integrity, typeorm]
dependencies: []
---

# updateRefreshTokenHash Bypasses Entity Lifecycle Hooks

## Problem Statement
`AdminRepository.updateRefreshTokenHash()` uses `repository.update()` which executes a raw SQL UPDATE and bypasses TypeORM entity lifecycle hooks (`@BeforeUpdate`). It also doesn't update the `updated_at` timestamp, causing stale metadata.

## Findings
- `src/modules/backoffice/repositories/admin.repository.ts` - `updateRefreshTokenHash` calls `this.repository.update(id, { refreshTokenHash })`
- TypeORM `Repository.update()` runs raw SQL, does not trigger `@BeforeInsert`/`@BeforeUpdate` hooks
- `updated_at` column with `@UpdateDateColumn()` is only auto-managed when using `save()`, not `update()`
- This is a deliberate performance choice (avoids loading entity), but the stale `updated_at` could mislead debugging and auditing

## Proposed Solutions

### Option A: Manually set updated_at in the update call
- **Description:** Add `updatedAt: new Date()` to the update payload: `this.repository.update(id, { refreshTokenHash, updatedAt: new Date() })`
- **Pros:** Keeps the performance benefit of raw update; fixes stale timestamp; minimal change
- **Cons:** Manual timestamp management; could drift from server time
- **Effort:** Small
- **Risk:** Low

### Option B: Use save() for consistency
- **Description:** Load the entity, set refreshTokenHash, call save(). This triggers all hooks and auto-updates timestamps.
- **Pros:** Consistent with other operations; all hooks fire; timestamps correct
- **Cons:** Extra SELECT query; slightly slower; may not be worth it for a simple field update
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented. Added `updatedAt: new Date()` to the raw update call. This preserves the single-query performance while ensuring the audit trail is correct.

## Technical Details
- **Affected files:** `src/modules/backoffice/repositories/admin.repository.ts`
- **Components:** AdminRepository

## Acceptance Criteria
- [x] `updated_at` reflects the actual last modification time after refresh token hash update
- [x] Decision documented on whether to use raw update or save()

## Work Log
- 2026-05-21: Created from PR #2 code review (Data integrity guardian)
- 2026-05-21: Resolved. Added `updatedAt: new Date()` to `repository.update()` call. Updated tests to verify updatedAt is included.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
