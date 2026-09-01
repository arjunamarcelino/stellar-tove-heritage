---
status: complete
priority: p1
issue_id: "056"
tags: [code-review, security, architecture, nestjs]
dependencies: []
---

# Missing JwtModule and BackofficeGuard in UsersModule (Runtime Crash)

## Problem Statement

The `UsersController` now uses `@UseGuards(BackofficeGuard)`, but the `UsersModule` does not import `JwtModule.register({})` or register `BackofficeGuard` as a provider. Every other backoffice module that uses `BackofficeGuard` follows this pattern. Without these registrations, NestJS cannot resolve `BackofficeGuard`'s dependencies (`JwtService`, `backofficeJwtConfig`) in the `UsersModule` context, causing a runtime crash on all `/backoffice/users` endpoints.

## Findings

- `src/modules/users/users.module.ts` — missing `JwtModule.register({})` in imports and `BackofficeGuard` in providers
- All 6 other backoffice modules (`AdminsModule`, `FilesModule`, `BackofficeStagesModule`, `BackofficeMissionsModule`, `BackofficeSubmissionsModule`, `BackofficeAuthModule`) correctly register both
- Unit tests pass because they mock all dependencies, so this DI issue is not caught by tests
- Identified independently by: security-sentinel (Finding 1) and architecture-strategist (Finding 2)

## Proposed Solutions

### Option 1: Add JwtModule and BackofficeGuard to UsersModule (Recommended)

**Approach:** Add the missing imports and providers to match the established pattern.

```typescript
// users.module.ts
import { JwtModule } from '@nestjs/jwt';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User]), JwtModule.register({})],
  providers: [
    { provide: 'IUserRepository', useClass: UserRepository },
    UsersService,
    BackofficeGuard,
  ],
  exports: [UsersService],
})
```

- **Pros:** Minimal change, fixes the issue, follows established pattern
- **Cons:** None
- **Effort:** Small
- **Risk:** None

## Recommended Action

Option 1 — this is a straightforward fix.

## Technical Details

- **Affected files:** `src/modules/users/users.module.ts`
- **Components:** UsersModule DI configuration

## Acceptance Criteria

- [ ] `UsersModule` imports `JwtModule.register({})`
- [ ] `UsersModule` registers `BackofficeGuard` as a provider
- [ ] All `/backoffice/users` endpoints are reachable at runtime with a valid admin JWT
