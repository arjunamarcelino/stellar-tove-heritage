---
status: complete
priority: p1
issue_id: 003
tags: [code-review, typescript, type-safety]
dependencies: []
---

# `as unknown as` Double Cast in BaseRepository.findOneById()

## Problem Statement
`src/common/repositories/base.repository.ts` line 39 uses `as unknown as FindOptionsWhere<T>` - a double cast that fully bypasses TypeScript's type system. This assumes every entity has a string `id` field, but there is no type-level guarantee of this. If an entity lacks an `id` field or uses a different primary key type, the code will fail at runtime with no compile-time warning.

## Findings
- `base.repository.ts:39` - `where: { id } as unknown as FindOptionsWhere<T>`. The `as unknown as` pattern is a double cast: first to `unknown` (erasing the original type), then to the target type (asserting without verification).
- The `BaseRepository<T>` generic type parameter `T` has no constraint requiring an `id` property. Any TypeORM entity could be used, including those with composite keys or non-string primary keys.
- This pattern appears in `findOneById()` but could propagate to other methods that assume the entity shape.

## Proposed Solutions

### Option A: Add a `HasId` interface constraint
- **Description:** Define an interface `interface HasId { id: string }` and constrain the base repository generic: `BaseRepository<T extends HasId>`. This makes `{ id }` a valid `FindOptionsWhere<T>` because TypeScript knows `T` has an `id: string` property. The double cast can then be removed.
- **Pros:** Removes the unsafe cast; enforces at compile time that all entities using BaseRepository have a string `id`; minimal code change; self-documenting constraint.
- **Cons:** Entities without a string `id` field cannot use `BaseRepository` directly (they would need a custom repository).
- **Effort:** Small
- **Risk:** Low

### Option B: Accept `FindOptionsWhere<T>` directly
- **Description:** Change `findOneById(id: string)` to `findOne(where: FindOptionsWhere<T>)`, pushing the responsibility of constructing a type-safe where clause to callers. This removes all assumptions about entity shape from the base repository.
- **Pros:** Fully generic; works with any entity shape including composite keys; no casts needed.
- **Cons:** Breaking API change for all callers; less ergonomic (callers must write `findOne({ id } as FindOptionsWhere<User>)` instead of `findOneById(id)`); pushes complexity to every call site.
- **Effort:** Medium
- **Risk:** Medium

## Recommended Action
Option A: Add a `HasId` interface constraint

## Implemented Solution

Implemented **Option A** — added a `HasId` interface constraint to enforce `id: string` at the type level:

### 1. `HasId` interface added (`src/common/repositories/base-repository.interface.ts`)
```typescript
export interface HasId extends ObjectLiteral {
  id: string;
}
```
Changed `IBaseRepository<T extends ObjectLiteral>` to `IBaseRepository<T extends HasId>`.

### 2. `BaseRepository` class updated (`src/common/repositories/base.repository.ts`)
- Changed `BaseRepository<T extends ObjectLiteral>` to `BaseRepository<T extends HasId>`.
- Removed the `as unknown as` double cast — with `T extends HasId`, TypeScript knows `T` has `id: string`, so `{ id } as FindOptionsWhere<T>` is a single valid assertion (down from double cast through `unknown`).

**Before:**
```typescript
export abstract class BaseRepository<T extends ObjectLiteral> implements IBaseRepository<T> {
  async findOneById(id: string): Promise<T | null> {
    return this.repository.findOne({
      where: { id } as unknown as FindOptionsWhere<T>,  // double cast
    });
  }
```

**After:**
```typescript
export abstract class BaseRepository<T extends HasId> implements IBaseRepository<T> {
  async findOneById(id: string): Promise<T | null> {
    return this.repository.findOne({
      where: { id } as FindOptionsWhere<T>,  // single assertion, type-safe
    });
  }
```

### Why a single `as` remains
`FindOptionsWhere<T>` is a mapped type that transforms each property through TypeORM's conditional types. Even though `T` is guaranteed to have `id: string`, TypeScript cannot infer that `{ id: string }` satisfies the mapped `FindOptionsWhere<T>` shape without a single assertion. This is a known TypeORM generics limitation — the assertion is safe because `HasId` guarantees `id` exists.

### Callers
All existing entities extend `BaseEntity` which has `id: string`, so the `HasId` constraint is satisfied everywhere. No caller changes needed.

### Commit
`938665e` — `fix(repo): add HasId constraint to eliminate double cast in findOneById`

## Technical Details
- **Affected Files:** `src/common/repositories/base.repository.ts`, `src/common/repositories/base-repository.interface.ts`
- **Components:** BaseRepository, IBaseRepository interface, HasId interface (new), all repository subclasses, all services that call `findOneById()`

## Acceptance Criteria
- [x] No `as unknown as` casts remain in `BaseRepository`
- [x] Entity type constraint ensures the `id` field exists at the type level
- [x] All existing unit and integration tests pass without modification (or with justified updates)
- [x] TypeScript compilation succeeds in strict mode with no type errors

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (HasId constraint). Commit `938665e` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
