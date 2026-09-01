---
status: complete
priority: p2
issue_id: 007
tags: [code-review, architecture, nestjs]
dependencies: []
---

# Duplicate JwtModule.register({})

## Problem Statement
`JwtModule.register({})` appears in both `src/app.module.ts` and `src/modules/auth/auth.module.ts`. This creates two separate JwtService instances in the NestJS dependency injection container. AuthModule should own JwtModule exclusively since only AuthService uses it. The duplicate registration adds confusion about which JwtService instance is being injected and could lead to subtle bugs if configuration diverges between the two registrations.

## Findings
- `src/app.module.ts`: Contains `JwtModule.register({})` in its imports array.
- `src/modules/auth/auth.module.ts`: Also contains `JwtModule.register({})` in its imports array.
- Only `AuthService` injects and uses `JwtService` for token generation and verification.
- The empty `{}` configuration in both registrations means neither has JWT options set at module level (options are likely passed per-call), but having two registrations is still architecturally incorrect.

## Proposed Solutions

### Option A: Remove JwtModule from AppModule
- **Description:** Remove `JwtModule.register({})` from `src/app.module.ts`. Keep it only in `src/modules/auth/auth.module.ts`. If any other module needs JwtService in the future, export it from AuthModule.
- **Pros:** Single source of truth for JWT configuration; cleaner module boundaries; follows NestJS best practices for module encapsulation.
- **Cons:** If a future module needs JwtService outside AuthModule, it must import AuthModule or JwtModule must be re-exported.
- **Effort:** Small
- **Risk:** Low

### Option B: Move JwtModule to a shared CoreModule
- **Description:** Create a CoreModule that registers JwtModule once and exports it. Both AppModule and AuthModule import CoreModule.
- **Pros:** Centralized shared module pattern; easy to add other shared providers.
- **Cons:** Over-engineering for a single module; adds indirection; CoreModule may not be needed yet.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Remove JwtModule from AppModule

## Implemented Solution

Implemented **Option A** — removed the duplicate `JwtModule.register({})` from `AppModule`:

- Removed `JwtModule.register({})` from the `imports` array in `src/app.module.ts`.
- Removed the unused `import { JwtModule } from '@nestjs/jwt'`.
- `AuthModule` retains `JwtModule.register({})` as the single source of truth.

**Before (`src/app.module.ts`):**
```typescript
imports: [
  ConfigModule.forRoot({ ... }),
  JwtModule.register({}),  // duplicate — AuthModule already has this
  DatabaseModule,
  ...
],
```

**After:**
```typescript
imports: [
  ConfigModule.forRoot({ ... }),
  DatabaseModule,
  ...
],
```

### Commit
`8e2be0c` — `fix(modules): remove duplicate JwtModule.register({}) from AppModule`

## Technical Details
- **Affected Files:** src/app.module.ts
- **Components:** JwtModule, AuthModule, AppModule, NestJS DI Container

## Acceptance Criteria
- [x] `JwtModule.register({})` appears in exactly one module
- [x] AuthService continues to receive a properly configured JwtService
- [x] All authentication flows (login, register, token refresh) work correctly
- [x] No duplicate provider warnings in application logs

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (remove from AppModule). Commit `8e2be0c` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
