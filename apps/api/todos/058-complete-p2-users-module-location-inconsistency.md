---
status: complete
priority: p2
issue_id: "058"
tags: [code-review, architecture, nestjs]
dependencies: ["056"]
---

# UsersController Routes to /backoffice/users but Lives Outside backoffice/

## Problem Statement

The `UsersController` routes to `/backoffice/users` and uses `BackofficeGuard`, but the module lives at `src/modules/users/` instead of `src/modules/backoffice/users/`. Every other backoffice controller lives under `src/modules/backoffice/{domain}/` and is imported through `BackofficeModule`. The `UsersModule` is the only exception — it's imported directly in `app.module.ts`.

There is a valid reason: `AuthModule` depends on `UsersService` for platform user auth. Moving the entire module would create a cross-boundary dependency.

## Findings

- 6 backoffice controllers live in `src/modules/backoffice/{domain}/`, imported via `BackofficeModule`
- `UsersController` is the only one outside this boundary
- `AuthModule` imports `UsersModule` for `UsersService.findByEmail()`, `create()`, `updateRefreshTokenHash()`
- The same split pattern exists for submissions: `src/modules/submissions/` (user-facing) + `src/modules/backoffice/submissions/` (backoffice)
- Identified by: architecture-strategist (Finding 1), pattern-recognition-specialist (Finding 2)

## Proposed Solutions

### Option 1: Split controller to backoffice boundary (Recommended)

**Approach:** Keep `UsersModule` at `src/modules/users/` with entity/repo/service (no controller). Create `BackofficeUsersModule` at `src/modules/backoffice/users/` with just the controller. Import `UsersModule` in `BackofficeUsersModule` for the service.

- **Pros:** Follows established pattern, matches submissions split pattern
- **Cons:** More files, slightly more indirection
- **Effort:** Medium
- **Risk:** Low

### Option 2: Keep as-is, document the exception

**Approach:** Add a comment in `UsersModule` explaining why it's top-level despite serving backoffice routes.

- **Pros:** No code change
- **Cons:** Inconsistency remains, may confuse contributors
- **Effort:** Small
- **Risk:** Low

## Technical Details

- **Affected files:** `src/modules/users/users.module.ts`, `src/modules/users/users.controller.ts`, `src/modules/backoffice/backoffice.module.ts`

## Acceptance Criteria

- [ ] Either: controller moved to `src/modules/backoffice/users/` with a `BackofficeUsersModule`
- [ ] Or: exception documented in `src/modules/users/CLAUDE.md`
