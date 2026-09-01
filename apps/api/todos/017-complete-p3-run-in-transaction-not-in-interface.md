---
status: complete
priority: p3
issue_id: 017
tags: [code-review, typescript, architecture]
dependencies: []
---

# runInTransaction Not in IBaseRepository Interface

## Problem Statement
`BaseRepository` has a `runInTransaction()` method but it is not declared in the `IBaseRepository` interface. Services depending on the interface cannot use transactions without casting to the concrete type.

## Findings
- `src/common/repositories/base.repository.ts`: contains `runInTransaction()` implementation
- `src/common/repositories/base-repository.interface.ts`: does not declare `runInTransaction()`

## Proposed Solutions

### Option A: Add to IBaseRepository Interface
- **Description:** Add the `runInTransaction` signature to `IBaseRepository`.
- **Pros:** Maintains DIP; consistent API surface
- **Cons:** Exposes EntityManager type in the interface
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Add to IBaseRepository Interface

## Implemented Solution

Added `runInTransaction<R>(work: (manager: EntityManager) => Promise<R>): Promise<R>` to the `IBaseRepository` interface and added `EntityManager` to the typeorm imports.

### Commit
`74d613f` — `fix(repo): add runInTransaction to IBaseRepository interface`

## Technical Details
- **Affected Files:** src/common/repositories/base-repository.interface.ts
- **Components:** IBaseRepository, BaseRepository

## Acceptance Criteria
- [x] `runInTransaction` is declared in `IBaseRepository` interface
- [x] Services can call `runInTransaction` through the interface without casting
- [x] TypeScript compilation passes with the updated interface
- [x] Existing usages of `runInTransaction` continue to work

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (add to interface). Commit `74d613f` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
