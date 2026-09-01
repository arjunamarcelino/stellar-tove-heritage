# Common Module

Shared infrastructure used across all feature modules.

## Structure

```
common/
  decorators/     # @Public(), @AdminRoles(), @CurrentUser(), @ApiCollectionResponse(), @ApiPaginatedResponse()
  dto/            # PaginationQueryDto, PaginatedResponseDto, CollectionResponseDto
  entities/       # BaseEntity (id, timestamps, soft delete)
  enums/          # AdminRole, ErrorCode
  filters/        # AllExceptionsFilter (global, DI-enabled via APP_FILTER)
  guards/         # AuthGuard (JWT, global), BackofficeGuard (admin JWT + RBAC)
  interfaces/     # AuthenticatedRequest, JwtPayload
  repositories/   # BaseRepository<T extends HasId>, IBaseRepository<T>
```

## Repository Pattern

`IBaseRepository<T extends HasId>` defines the contract. `BaseRepository<T>` implements it with TypeORM. All entities must have `id: string`.

Key methods: `create`, `save`, `findOneById`, `findAll`, `findWithPagination`, `update` (uses save() for lifecycle hooks), `softRemove`, `runInTransaction`.

When adding a new repository:
1. Create interface in a separate file (e.g., `artwork-repository.interface.ts`)
2. Extend `BaseRepository<T>` for the implementation
3. Inject via the interface token, not the concrete class

## Guards

Registered globally in `app.module.ts` in this exact order:
1. `UserAwareThrottlerGuard` (the `ThrottlerGuard`) -- keys the rate-limit tracker on the JWT `sub`, not IP. It runs before `AuthGuard`, so it verifies the bearer itself: tries the **user** access secret (`user:<sub>`), then the **backoffice** secret (`admin:<sub>` when `type==='admin'`, TOV-241 todo 268 -- admin tokens are signed with a different secret, so without this they silently degrade to per-IP keying and all admins behind a shared NAT/LB share one bucket), else `ip:<addr>`. `@Throttle` overrides the limit per-route; the keying is unaffected.
2. AuthGuard (respects `@Public()` decorator)

Backoffice controllers use `@Public()` at class level to bypass the global `AuthGuard`, then `@UseGuards(BackofficeGuard)` + `@AdminRoles()` for admin-specific JWT auth and RBAC. Each backoffice module must register `BackofficeGuard` as a provider and import `JwtModule.register({})`.

## Error Handling

`AllExceptionsFilter` maps HTTP statuses to `ErrorCode` enum values. Non-HttpException errors always return `"Internal server error"` -- never leak internals. Custom exceptions can set `errorCode` in their response body.

`failHttp(code, status, msg)` builds the canonical `{ statusCode, error, message, errorCode }` body. **`failValidation(errors: FieldError[])`** (TOV-30) is the sanctioned 422 `VALIDATION_FAILED` shape carrying a field-level `errors[]` (dotted paths like `socialLinks.twitter`) — use it (not a bespoke body) when a surface needs field-level validation errors that the global 400 `ValidationPipe` can't produce.

## Adding New Enums

Add to `src/common/enums/`. Error codes go in `error-code.enum.ts` prefixed with domain (e.g., `ARTWORK_NOT_FOUND`).
