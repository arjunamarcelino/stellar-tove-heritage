---
status: complete
priority: p1
issue_id: 002
tags: [code-review, typescript, type-safety]
dependencies: []
---

# `as never` Type Escape in BaseRepository.update()

## Problem Statement
`src/common/repositories/base.repository.ts` line 64 uses `as never` to silence TypeScript on the `update()` method. This completely defeats TypeScript's type checker - any value could be passed and the compiler won't catch it. A runtime error could occur if the wrong shape is passed to TypeORM's `update()`.

## Findings
- `base.repository.ts:64` - `await this.repository.update(id, data as never)`. The `as never` cast tells TypeScript to accept any value without checking.
- The issue is that TypeORM's `update()` expects `QueryDeepPartialEntity<T>` but the method parameter is typed as `DeepPartial<T>`. These are structurally different types: `QueryDeepPartialEntity` forbids certain nested entity relations that `DeepPartial` allows.
- Any caller could pass a malformed object and TypeScript would not flag it at compile time.

## Proposed Solutions

### Option A: Use `QueryDeepPartialEntity<T>` as the parameter type
- **Description:** Change the `update()` method signature to accept `QueryDeepPartialEntity<T>` instead of `DeepPartial<T>`. Import `QueryDeepPartialEntity` from `typeorm`. This aligns the method's parameter type with what TypeORM actually expects.
- **Pros:** Direct fix; removes the unsafe cast entirely; callers get accurate type checking; minimal code change.
- **Cons:** Callers may need minor adjustments if they were relying on `DeepPartial<T>` semantics for the update payload.
- **Effort:** Small
- **Risk:** Low

### Option B: Use `save()` with preloaded entity instead of `update()`
- **Description:** Load the entity first via `findOneById()`, merge the incoming changes onto the loaded entity, then call `this.repository.save()`. The `save()` method accepts `DeepPartial<T>` natively, so no cast is needed.
- **Pros:** Fully type-safe without any signature changes; triggers TypeORM lifecycle hooks (`@BeforeUpdate`, subscribers); returns the full updated entity.
- **Cons:** Requires an extra SELECT query per update; slightly higher latency; different transactional behavior than `update()`.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Use `QueryDeepPartialEntity<T>` as the parameter type

## Implemented Solution

Implemented **Option A** — changed the parameter type to match TypeORM's actual API:

### 1. `IBaseRepository` interface updated (`src/common/repositories/base-repository.interface.ts`)
- Added `QueryDeepPartialEntity` to imports from `typeorm`.
- Changed `update()` signature from `data: DeepPartial<T>` to `data: QueryDeepPartialEntity<T>`.

### 2. `BaseRepository` class updated (`src/common/repositories/base.repository.ts`)
- Added `QueryDeepPartialEntity` to imports.
- Changed `update()` method parameter type to `QueryDeepPartialEntity<T>`.
- Removed the `as never` cast — `this.repository.update(id, data)` now type-checks cleanly because the parameter type matches what TypeORM expects.

**Before:**
```typescript
async update(id: string, data: DeepPartial<T>): Promise<T> {
    await this.repository.update(id, data as never);  // unsafe cast
```

**After:**
```typescript
async update(id: string, data: QueryDeepPartialEntity<T>): Promise<T> {
    await this.repository.update(id, data);  // no cast needed
```

### Callers
All existing callers (`UsersService.update()` passing `UpdateUserDto`, `UsersService.updateRefreshTokenHash()` passing `{ refreshTokenHash: hash }`) are compatible with `QueryDeepPartialEntity<User>` — no caller changes needed.

### Commit
`575d5d3` — `fix(repo): replace 'as never' with proper QueryDeepPartialEntity type`

## Technical Details
- **Affected Files:** `src/common/repositories/base.repository.ts`, `src/common/repositories/base-repository.interface.ts`
- **Components:** BaseRepository, IBaseRepository interface, all repository subclasses that inherit `update()`

## Acceptance Criteria
- [x] No `as never` casts remain in `BaseRepository`
- [x] The `update()` method accepts a properly typed parameter matching TypeORM's expectations
- [x] All existing unit and integration tests pass without modification (or with justified updates)
- [x] TypeScript compilation succeeds in strict mode with no type errors

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (QueryDeepPartialEntity<T>). Commit `575d5d3` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
