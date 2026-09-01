---
status: complete
priority: p2
issue_id: 010
tags: [code-review, architecture, clean-architecture]
dependencies: []
---

# IUserRepository Defined Inside Concrete Repository File

## Problem Statement
In `src/modules/users/repositories/user.repository.ts`, both the `IUserRepository` interface and the `UserRepository` class are defined in the same file. This violates the Dependency Inversion Principle - the interface (abstraction) should not live alongside its implementation. Other modules importing the interface are forced to pull in the concrete class and its dependencies (TypeORM, database driver, etc.), defeating the purpose of depending on abstractions.

## Findings
- `src/modules/users/repositories/user.repository.ts`: Contains both `IUserRepository` interface definition and `UserRepository` class implementation in a single file.
- Clean Architecture requires that high-level modules depend on abstractions (interfaces), not concretions (implementations).
- Importing `IUserRepository` from this file also imports `UserRepository` and its transitive dependencies.

## Proposed Solutions

### Option A: Move interface to a separate file
- **Description:** Create `src/modules/users/repositories/user-repository.interface.ts` and move the `IUserRepository` interface there.
- **Pros:** Clean separation of abstraction from implementation; enables true Dependency Inversion; follows Clean Architecture conventions.
- **Cons:** One additional file; requires updating import paths.
- **Effort:** Small
- **Risk:** Low

### Option B: Move interface to a domain/ports directory
- **Description:** Create a `src/modules/users/ports/` directory and place the interface there.
- **Pros:** Full hexagonal architecture alignment; clear port/adapter separation.
- **Cons:** Introduces a new directory convention; may be premature for current codebase size.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Move interface to a separate file

## Implemented Solution

Implemented **Option A** — extracted `IUserRepository` to its own file:

### 1. New file `src/modules/users/repositories/user-repository.interface.ts`
```typescript
import { User } from '../entities/user.entity';

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
}
```

### 2. Updated `user.repository.ts`
- Removed the inline `IUserRepository` interface definition.
- Added `import { IUserRepository } from './user-repository.interface'`.

### 3. Updated `users.service.ts`
- Changed import from `'./repositories/user.repository'` to `'./repositories/user-repository.interface'`.

### Commit
`85716bd` — `refactor(users): extract IUserRepository to separate interface file`

## Technical Details
- **Affected Files:** src/modules/users/repositories/user.repository.ts, src/modules/users/repositories/user-repository.interface.ts (new), src/modules/users/users.service.ts
- **Components:** IUserRepository, UserRepository, Clean Architecture Layers, Dependency Injection

## Acceptance Criteria
- [x] IUserRepository interface is in a separate file from UserRepository implementation
- [x] All imports of IUserRepository reference the new file path
- [x] No circular dependencies introduced
- [x] Application compiles and all tests pass

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (separate interface file). Commit `85716bd` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
