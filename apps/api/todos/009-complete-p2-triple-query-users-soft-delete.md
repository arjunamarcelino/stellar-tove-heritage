---
status: complete
priority: p2
issue_id: 009
tags: [code-review, performance, database]
dependencies: []
---

# Triple-Query Pattern in UsersService.softDelete()

## Problem Statement
In `src/modules/users/users.service.ts` lines 62-70, the `softDelete()` method executes 3 separate database queries: `findOneById()` (SELECT), `save()` with `refreshTokenHash = null` (UPDATE full row), and `softRemove()` (UPDATE deletedAt). The `save()` call updates the entire entity when only `refreshTokenHash` needs to change. This is unnecessarily expensive for what should be a simple soft-delete operation.

## Findings
- `src/modules/users/users.service.ts` lines 62-70: Three sequential database operations for a single soft delete.
  1. `findOneById(id)` - SELECT query to load the user entity.
  2. `save({ ...user, refreshTokenHash: null })` - UPDATE query that writes the entire entity row just to null out one field.
  3. `softRemove(user)` - UPDATE query that sets `deletedAt` timestamp.
- The `save()` in step 2 writes every column of the user entity, not just `refreshTokenHash`.
- Steps 2 and 3 could be combined since `softRemove()` internally calls `save()`.

## Proposed Solutions

### Option A: Remove intermediate save() — let softRemove() persist both changes
- **Description:** Set `refreshTokenHash = null` on the loaded entity, then call `softRemove()` directly. Since `softRemove()` internally sets `deletedAt` and calls `save()`, the modified `refreshTokenHash` is persisted in the same UPDATE query.
- **Pros:** Reduces 3 queries to 2; minimal code change; triggers entity lifecycle hooks; maintains existing `softRemove` semantics.
- **Cons:** Still 2 queries (SELECT + save via softRemove).
- **Effort:** Small
- **Risk:** Low

### Option B: Single UPDATE with QueryBuilder
- **Description:** Replace all three operations with a single QueryBuilder UPDATE that sets both `refreshTokenHash = null` and `deletedAt = NOW()` in one query.
- **Pros:** Reduces 3 queries to 1; most efficient approach; atomic operation.
- **Cons:** Bypasses TypeORM entity lifecycle hooks; does not return the entity; must handle "not found" separately.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Remove intermediate save() — let softRemove() persist both changes

## Implemented Solution

Implemented **Option A** — removed intermediate `save()` call:

**Before:**
```typescript
async softDelete(id: string): Promise<void> {
  const user = await this.userRepository.findOneById(id);  // Query 1: SELECT
  if (!user) { throw new NotFoundException(...); }
  user.refreshTokenHash = null;
  await this.userRepository.save(user);       // Query 2: UPDATE (redundant)
  await this.userRepository.softRemove(user);  // Query 3: UPDATE (deletedAt)
}
```

**After:**
```typescript
async softDelete(id: string): Promise<void> {
  const user = await this.userRepository.findOneById(id);  // Query 1: SELECT
  if (!user) { throw new NotFoundException(...); }
  user.refreshTokenHash = null;
  await this.userRepository.softRemove(user);  // Query 2: sets deletedAt AND saves refreshTokenHash=null
}
```

`softRemove()` internally calls `save()` with the `deletedAt` field set, so the modified `refreshTokenHash = null` is persisted in the same UPDATE query.

### Commit
`f0e5fce` — `fix(users): reduce softDelete from 3 queries to 2`

## Technical Details
- **Affected Files:** src/modules/users/users.service.ts
- **Components:** UsersService, UserRepository, TypeORM, Soft Delete

## Acceptance Criteria
- [x] softDelete uses fewer database queries than the current 3-query pattern
- [x] refreshTokenHash is set to null when a user is soft-deleted
- [x] deletedAt timestamp is correctly set
- [x] Soft-deleted users are excluded from normal queries (TypeORM default behavior preserved)
- [x] Existing tests pass with the optimized implementation

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (remove intermediate save). Commit `f0e5fce` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
