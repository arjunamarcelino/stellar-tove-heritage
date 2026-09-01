---
status: complete
priority: p2
issue_id: 012
tags: [code-review, typescript, quality]
dependencies: []
---

# Missing Return Types on Controller Methods

## Problem Statement
In `src/modules/users/users.controller.ts`, all 5 controller methods (`findAll`, `findOne`, `create`, `update`, `delete`) lack explicit return type annotations. Additionally, `src/modules/auth/auth.service.ts` `getProfile()` and `src/modules/auth/auth.controller.ts` `getProfile()` are missing return types. Explicit return type annotations serve as documentation, catch unintended return type changes at compile time, and improve OpenAPI spec accuracy.

## Findings
- `src/modules/users/users.controller.ts`: All 5 methods lack explicit return type annotations.
- `src/modules/auth/auth.service.ts`: `getProfile()` has no explicit return type.
- `src/modules/auth/auth.controller.ts`: `getProfile()` has no explicit return type.

## Proposed Solutions

### Option A: Add explicit return types to all public methods
- **Description:** Add `Promise<T>` return type annotations to all controller and public service methods.
- **Pros:** Self-documenting; compile-time safety; better OpenAPI spec generation.
- **Cons:** Slightly more verbose; must be maintained when return types change.
- **Effort:** Small
- **Risk:** Low

### Option B: Enable ESLint rule and fix incrementally
- **Description:** Enable `@typescript-eslint/explicit-module-boundary-types` as a warning first.
- **Pros:** Enforces pattern going forward; prevents regression.
- **Cons:** Warning-level rules may be ignored.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Add explicit return types to all public methods

## Implemented Solution

Implemented **Option A** — added explicit return type annotations:

### `users.controller.ts`
```typescript
findAll(...): Promise<PaginatedResponseDto<UserResponseDto>>
findOne(...): Promise<UserResponseDto>
create(...): Promise<UserResponseDto>
update(...): Promise<UserResponseDto>
delete(...): Promise<void>
```

### `auth.service.ts`
```typescript
async getProfile(userId: string): Promise<UserResponseDto>
```

### `auth.controller.ts`
```typescript
getProfile(...): Promise<UserResponseDto>
```

### Commit
`82ca5d0` — `fix(types): add explicit return types to controller and service methods`

## Technical Details
- **Affected Files:** src/modules/users/users.controller.ts, src/modules/auth/auth.service.ts, src/modules/auth/auth.controller.ts
- **Components:** UsersController, AuthService, AuthController, TypeScript Compiler, OpenAPI/Swagger

## Acceptance Criteria
- [x] All controller methods in `users.controller.ts` have explicit return type annotations
- [x] `getProfile()` in `auth.service.ts` has an explicit return type annotation
- [x] Return types accurately reflect the actual returned values
- [x] OpenAPI/Swagger spec correctly reflects the return types
- [x] TypeScript compilation succeeds with no new errors

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (explicit return types). Commit `82ca5d0` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
