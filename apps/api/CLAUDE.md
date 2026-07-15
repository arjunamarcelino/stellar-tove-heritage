# Tove Backend

Fractionalized art tokenization (RWA) platform backend.

## Tech Stack

- **Runtime:** NestJS 11, TypeScript (strict mode), SWC compiler
- **Database:** PostgreSQL 16 via TypeORM, synchronize:false, hand-written migrations
- **Auth:** JWT without Passport -- dual tokens (access + refresh with HMAC-SHA256 hashing)
- **Queue:** BullMQ with Redis for background job processing
- **Testing:** Vitest (unit, integration, e2e with separate configs)
- **Containerization:** Multi-stage Dockerfile, docker-compose (dev + prod)

## Architecture

Clean Architecture with abstract repository pattern:

```
src/
  app.module.ts          # Root module -- global providers/guards; imports PublicApiModule + BackofficeModule
  main.ts                # Bootstrap entry point (dotenv/config first; builds two Swagger docs)
  common/                # Shared: guards, filters, decorators, base classes, enums, constants
  config/                # registerAs config factories with Joi validation
  database/              # TypeORM module, data-source, migrations
  modules/
    public-api.module.ts # Groups public leaf modules under the `api/v1` prefix (RouterModule)
    auth/                # JWT auth: login, register, refresh, logout; + SEP-10 wallet auth + embedded passkey registration
    users/               # User domain (no controller; HTTP lives in backoffice/users)
    health/              # Health check endpoint (@nestjs/terminus)
    stages/, submissions/# Public user-facing surfaces
    files/               # Neutral files domain (entity/repo/service) + public proxy controller
    storage/             # Supabase storage abstraction
    relayer/             # RELAYER_SERVICE port -- deploys passkey smart-wallets + submits passkey-signed transfers (Redis RELAYER_ACCOUNT_LOCK)
    jobs/                # BullMQ background job processing
    backoffice/          # backoffice.module.ts groups admin leaf modules under `api/backoffice/v1`
      auth/ admins/ dashboard/ files/ missions/ stages/ submissions/ users/
```

### API Surfaces (Two Prefix Trees)

The API is split into two surfaces, each prefixed by `RouterModule` (NOT `setGlobalPrefix`):

- **Public** -> `api/v1/...` via `PublicApiModule` (Swagger UI `/docs/public`)
- **Backoffice** -> `api/backoffice/v1/...` via `BackofficeModule` (Swagger UI `/docs/backoffice`)

Each module exports a leaf-module array (`PUBLIC_MODULES` / `BACKOFFICE_MODULES`) that feeds BOTH
`RouterModule.register({ children })` and Swagger's `include`, so routes and docs cannot drift.
`RouterModule` prefixes controllers by their **declaring** module, so a controller's `@Controller()`
uses only its resource name (e.g. `@Controller('admins')`, not `backoffice/admins`). Prefix values
come from `src/common/constants/api-prefix.constant.ts` (read at module-decoration time, before DI);
`app.config.ts` re-exports those same constants so cookie paths and docs paths stay in lockstep.
In non-development, only the public Swagger JSON is served (`/api/v1/docs/json`); the backoffice
spec is dev-only.

## Key Patterns

### Repository Pattern

All repositories extend `BaseRepository<T extends HasId>` implementing `IBaseRepository<T>`. Domain-specific repos have their own interface file (e.g., `user-repository.interface.ts`).

### Configuration

All config uses `registerAs` pattern. Never use raw `configService.get('ENV_VAR')`. Add new configs to `ConfigModule.forRoot({ load: [...] })` in `app.module.ts` and validate with the Joi schema in `validation-schema.ts`. The one sanctioned exception is `src/common/constants/api-prefix.constant.ts`: `RouterModule` is evaluated at module-decoration time (before DI), so the route prefixes must read `process.env` directly. `app.config.ts` re-exports those constants (single source of truth) and `main.ts` imports `dotenv/config` first so `.env` overrides apply.

### Global Guards (Order Matters)

Registered in `app.module.ts` via `APP_GUARD`:
1. `UserAwareThrottlerGuard` -- rate limiting first; keys the tracker on the verified JWT `sub` (per-identity limits) with IP fallback for anonymous/invalid-token requests. Runs before `AuthGuard`, so it verifies the bearer token itself (TOV-25 #165).
2. `AuthGuard` -- JWT verification, sets `request.user` (respects `@Public()`)

Backoffice controllers bypass the global `AuthGuard` with `@Public()` at class level, then use `@UseGuards(BackofficeGuard)` + `@AdminRoles()` for admin-specific JWT auth and RBAC. The global `AuthGuard` resolves `JwtService` from `JwtModule.register({})` imported directly in `app.module.ts` (kept explicit at the app level, not via a feature-module re-export).

### Error Handling

Global `AllExceptionsFilter` registered via `APP_FILTER` (DI-enabled). Returns structured `ErrorCode` enum values. Non-HttpException errors always return generic messages.

### Auth Security

- Timing-safe comparisons (`crypto.timingSafeEqual`) for all token/hash verification
- HMAC-SHA256 refresh token hashing with dedicated secret
- Dual-channel refresh: httpOnly cookie + request body
- Entity-level `@BeforeInsert`/`@BeforeUpdate` password hash validation
- Race condition handling via PostgreSQL `23505` unique constraint catch

## Commands

```bash
yarn dev              # Start development server
yarn build            # Build for production
yarn start:prod       # Run production build
yarn test             # Unit tests
yarn test:integration # Integration tests (requires DB)
yarn test:e2e         # E2E tests (requires DB)
yarn migration:run    # Run pending migrations
yarn migration:revert # Revert last migration
```

## Database

- Migrations in `src/database/migrations/` -- never use `synchronize: true`
- Shared defaults in `src/config/database.defaults.ts`
- Data source for CLI: `src/database/data-source.ts`
- All entities extend `BaseEntity` with soft deletes -- use partial indexes (`WHERE deleted_at IS NULL`)
- Connection pool: max 20, min 5, 5s connection timeout, 30s idle timeout

## Testing

```
test/
  unit/           # Pure unit tests, mocked dependencies
  integration/    # Database-backed tests, real TypeORM
  e2e/            # Full HTTP tests via supertest
  shared/         # Shared helpers (truncateTables)
```

- Shared test helper: `test/shared/helpers.ts` (`truncateTables`)
- Integration setup: `test/integration/setup.ts` (`createTestingModule`)
- Separate vitest configs: `vitest.config.ts`, `vitest.config.integration.ts`, `vitest.config.e2e.ts`

## Documentation

- `docs/brainstorms/` -- Initial feature exploration
- `docs/plans/` -- Implementation plans with checkboxes
- `docs/solutions/` -- Documented problem solutions
- `todos/` -- Review findings with YAML frontmatter tracking
