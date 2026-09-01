---
status: complete
priority: p1
issue_id: 023
tags: [code-review, security, authentication, nestjs]
dependencies: []
---

# @Public() Decorator Bypasses BackofficeGuard Authentication

## Problem Statement
Class-level `@Public()` on `BackofficeAuthController` and `AdminsController` causes `BackofficeGuard.canActivate()` to return `true` immediately (at the isPublic check) before reaching JWT verification or role checks. The `Reflector.getAllAndOverride()` method checks handler-level metadata first, then class-level. Since the class has `@Public()`, any handler WITHOUT its own `@Public()` override inherits `isPublic = true` from the class. This means endpoints like register, logout, profile, and all admin CRUD may be completely unprotected despite appearing guarded.

## Findings
- `src/modules/backoffice/backoffice-auth.controller.ts` has `@Public()` at class level (intended to bypass global AuthGuard) AND `@UseGuards(BackofficeGuard)` on the class
- `src/modules/backoffice/admins.controller.ts` has same pattern: `@Public()` + `@UseGuards(BackofficeGuard)`
- `src/common/guards/backoffice.guard.ts:28-34` checks `isPublic` via `reflector.getAllAndOverride('isPublic', [context.getHandler(), context.getClass()])` - class-level `@Public()` causes this to return `true` for ALL handlers
- Only login and refresh have explicit `@Public()` at method level (which is redundant since class already has it)
- The E2E tests pass because they test auth rejection (401), but this may be because the E2E test setup differs from production behavior - needs investigation

## Proposed Solutions

### Option A: Remove class-level @Public(), add method-level @Public() only to login/refresh
- **Description:** Remove `@Public()` from controller classes. Add `@Public()` to individual methods that should be public (login, refresh). BackofficeGuard will then only skip auth for explicitly public methods. For the global AuthGuard bypass, use a different mechanism (e.g., a separate `@SkipGlobalAuth()` decorator or configure AuthGuard to ignore backoffice routes).
- **Pros:** Clear intent per endpoint; eliminates ambiguity; each route's auth requirement is explicit
- **Cons:** Requires a new mechanism to bypass global AuthGuard for backoffice routes; more decorators per method
- **Effort:** Medium
- **Risk:** Medium - must ensure global AuthGuard still doesn't interfere

### Option B: Make BackofficeGuard ignore class-level @Public()
- **Description:** Modify BackofficeGuard to only check handler-level `@Public()` metadata using `reflector.get('isPublic', context.getHandler())` instead of `getAllAndOverride` which checks both handler and class.
- **Pros:** Minimal code change; keeps existing decorator structure; class-level @Public() only affects global AuthGuard
- **Cons:** Subtle behavioral difference between guards checking same metadata key; could confuse future developers
- **Effort:** Small
- **Risk:** Low

### Option C: Use separate metadata keys for global vs backoffice auth
- **Description:** Create a `@SkipBackofficeAuth()` decorator with its own metadata key (e.g., 'skipBackofficeAuth'). BackofficeGuard checks this key. `@Public()` only affects global AuthGuard.
- **Pros:** No ambiguity; each guard checks its own metadata; clear separation of concerns
- **Cons:** More decorators to manage; slightly more boilerplate
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option B: Make BackofficeGuard check handler-only @Public() metadata.

## Technical Details
- **Affected files:** `src/modules/backoffice/backoffice-auth.controller.ts`, `src/modules/backoffice/admins.controller.ts`, `src/common/guards/backoffice.guard.ts`
- **Components:** BackofficeGuard, BackofficeAuthController, AdminsController

## Acceptance Criteria
- [ ] Protected backoffice endpoints (register, logout, profile, admin CRUD) return 401 without valid admin JWT
- [ ] Login and refresh remain accessible without authentication
- [ ] E2E tests verify auth requirements for each endpoint
- [ ] No regression in global AuthGuard behavior for user routes

## Work Log
- 2026-05-21: Created from PR #2 code review (TypeScript reviewer, Architecture strategist)
- 2026-05-21: Fixed via Option B. Changed `reflector.getAllAndOverride()` to `reflector.get()` on handler only in BackofficeGuard. Class-level `@Public()` now only affects global AuthGuard. Added unit tests verifying handler-only check and class-level bypass rejection. Commit: 32bd10e

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
