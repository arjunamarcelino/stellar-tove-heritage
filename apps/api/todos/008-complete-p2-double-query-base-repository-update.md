---
status: complete
priority: p2
issue_id: 008
tags: [code-review, performance, database]
dependencies: []
---

# Double-Query Pattern in BaseRepository.update()

## Problem Statement
In `src/common/repositories/base.repository.ts` lines 60-67, the `update()` method calls `this.repository.update(id, data)` followed by `this.findOneById(id)`. This executes 2 separate database queries (UPDATE + SELECT) for every update operation. TypeORM's `update()` does not return the updated entity, requiring a follow-up fetch. More critically, `repository.update()` bypasses entity lifecycle hooks (`@BeforeUpdate`, `@AfterUpdate`), so hooks like `normalizeEmail()` on the User entity are never triggered during updates.

## Findings
- `src/common/repositories/base.repository.ts` lines 60-67: `update()` performs `this.repository.update(id, data)` then `this.findOneById(id)`.
- TypeORM's `Repository.update()` returns `UpdateResult` (affected row count), not the entity itself.
- `Repository.update()` bypasses entity lifecycle hooks — `@BeforeUpdate`/`@AfterUpdate` decorators are not triggered.
- The User entity has `@BeforeUpdate() normalizeEmail()` which would be skipped by the raw `update()` call.

## Proposed Solutions

### Option A: Use save() with preloaded entity
- **Description:** Change the pattern to: load entity with `findOneById()`, merge the update data with `Object.assign()`, then call `this.repository.save(entity)`. This is still 2 queries (SELECT + UPDATE via save) but follows the standard TypeORM entity lifecycle and triggers entity listeners/subscribers.
- **Pros:** Standard TypeORM pattern; triggers BeforeUpdate/AfterUpdate hooks; returns the full entity; compatible with entity listeners.
- **Cons:** Still 2 queries; loads full entity before update; slightly different semantics (save vs update).
- **Effort:** Small
- **Risk:** Low

### Option B: Use QueryBuilder with RETURNING clause
- **Description:** Replace with `this.repository.createQueryBuilder().update().set(data).where("id = :id", { id }).returning("*").execute()` to perform the update and return the entity in a single query.
- **Pros:** Single database round-trip; most efficient approach; reduces latency.
- **Cons:** PostgreSQL-specific (RETURNING clause); raw result needs to be mapped to entity; does not trigger TypeORM entity listeners; more complex code.
- **Effort:** Medium
- **Risk:** Medium

## Recommended Action
Option A: Use save() with preloaded entity

## Implemented Solution

Implemented **Option A** — use `save()` with preloaded entity to trigger lifecycle hooks:

### Changes to `base.repository.ts` and `base-repository.interface.ts`
- Changed `update()` parameter type from `QueryDeepPartialEntity<T>` back to `DeepPartial<T>` (since `save()` accepts `DeepPartial<T>` natively).
- Replaced `repository.update()` + `findOneById()` with `findOneById()` + `Object.assign()` + `save()`.
- Removed unused `QueryDeepPartialEntity` import from both files.

**Before:**
```typescript
async update(id: string, data: QueryDeepPartialEntity<T>): Promise<T> {
  await this.repository.update(id, data);        // bypasses @BeforeUpdate hooks
  const entity = await this.findOneById(id);      // extra SELECT
  if (!entity) { throw new NotFoundException(...); }
  return entity;
}
```

**After:**
```typescript
async update(id: string, data: DeepPartial<T>): Promise<T> {
  const entity = await this.findOneById(id);      // SELECT
  if (!entity) { throw new NotFoundException(...); }
  Object.assign(entity, data);
  return this.repository.save(entity);            // triggers @BeforeUpdate, then UPDATE
}
```

### Why this is better
- `save()` triggers entity lifecycle hooks (`@BeforeUpdate`, `@AfterUpdate`), so `normalizeEmail()` runs on User updates.
- The parameter type is `DeepPartial<T>` which `save()` accepts natively — no casts needed.
- Query count is the same (2), but the order changes from UPDATE+SELECT to SELECT+save(UPDATE), which is the standard TypeORM pattern.

### Commit
`62ed158` — `fix(repo): use save() pattern in update() to trigger entity lifecycle hooks`

## Technical Details
- **Affected Files:** src/common/repositories/base.repository.ts, src/common/repositories/base-repository.interface.ts
- **Components:** BaseRepository, IBaseRepository, TypeORM, Database Layer

## Acceptance Criteria
- [x] Update operation follows a standard TypeORM pattern or is optimized to fewer queries
- [x] Updated entity is correctly returned after the operation
- [x] All existing update-dependent tests pass
- [x] Entity relations and computed fields are correctly populated in the returned entity

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (save with preloaded entity). Commit `62ed158` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
