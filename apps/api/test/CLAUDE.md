# Testing

Vitest test runner with three separate configurations.

## Structure

```
test/
  unit/              # Mocked dependencies, no DB
  integration/       # Real database, real TypeORM
  e2e/               # Full HTTP via supertest
  shared/
    helpers.ts       # truncateTables() -- shared cleanup utility
```

## Running Tests

```bash
yarn db:test:setup       # One-time: provision the local tove_test database (see below)
yarn test                # Unit tests (vitest.config.ts) -- no DB needed
yarn test:integration    # Integration tests (vitest.config.integration.ts) -- needs local DB
yarn test:e2e            # E2E tests (vitest.config.e2e.ts) -- needs local DB + Redis
```

## Local Test Database

Integration and e2e both run against a **local** Postgres `tove_test` database (never the
shared remote dev DB, which caused connection-timeout flakes). Provision it once with:

```bash
yarn db:test:setup       # creates role `tove` + db `tove_test`, loads migrations (idempotent)
```

The schema is loaded out-of-band by this script (via `scripts/setup-test-db.sh`) rather than
at test time: TypeORM cannot load the `.ts` migrations at runtime under vitest/SWC, so both
suites use `migrationsRun: false` and expect a pre-migrated database. After changing
migrations, re-run `yarn db:test:setup`.

Config overrides: **both** `vitest.config.e2e.ts` and `vitest.config.integration.ts` pin
`DB_*` to the local `tove_test` DB via their `env` block, so an exported `DB_DATABASE` /
`DB_HOST` can never point a suite at a dev/prod database. As a second line of defense,
`truncateTables` (`test/shared/helpers.ts`) throws unless the connected database name contains
`test`. Both configs also set `fileParallelism: false` since all files share the one `tove_test`
DB and truncate between tests. (Note: the NestJS `ConfigModule`'s `ignoreEnvFile: true` does
**not** protect the DB connection — the TypeORM options read `process.env` directly — which is
why the vitest `env` pinning above is the real guardrail.)

## Integration Test Setup

Use `createTestingModule()` from `test/integration/setup.ts`. It configures:
- ConfigModule with test env vars
- TypeORM connected to the pre-migrated `tove_test` database (`migrationsRun: false`)

```typescript
import { createTestingModule, truncateTables } from '../integration/setup';

beforeEach(async () => {
  await truncateTables(dataSource);
});
```

## E2E Test Setup

Use the full `AppModule` with `Test.createTestingModule({ imports: [AppModule] })`. Set up
`ValidationPipe` and `cookieParser` manually to match `main.ts`. Route prefixes (`api/v1`,
`api/backoffice/v1`) come from `RouterModule` inside `AppModule` -- do **not** call
`setGlobalPrefix`. Override `ThrottlerStorage` with a no-op so per-route `@Throttle` limits
(register 3/min, login 5/min) don't trip during a suite run:

```typescript
import { noOpThrottlerStorage } from '../shared/helpers';

Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ThrottlerStorage)
  .useValue(noOpThrottlerStorage)
  .compile();
```

## Conventions

- Unit test files: `test/unit/modules/{module}/{file}.spec.ts`
- Integration test files: `test/integration/modules/{module}/{file}.integration.spec.ts`
- E2E test files: `test/e2e/{feature}.e2e-spec.ts`
- Use `truncateTables()` from `test/shared/helpers.ts` for DB cleanup
- Do not create inline test data -- use shared factories. `test/shared/seed-offering.ts` (`insertOffering(q, opts)`) is the offering-row seeder used across the offerings integration + e2e specs (TOV-165 #347): pass any query handle (`ds.query` / a `q` wrapper) + overrides; defaults are decomposition-consistent (`total_supply = public_float`, retentions `0`). Exception: `offerings.constraints.integration.spec.ts` keeps its own inserts because the offering inserts ARE its subject-under-test.
- `test/shared/seed-artwork.ts` (`insertArtwork(q, opts)` + `insertArtworkArtist(q, id)`) is the artwork-row seeder (TOV-189): seed the `users` artist first (FK `artist_user_id → users ON DELETE RESTRICT`), then the artwork + optional `supportingImages` (`{ storagePath, sortOrder }`, seed OUT of order to prove `ORDER BY`) + `custodian`/`coaStoragePath`. `test/shared/fake-storage.ts` (`FakeStorageService`) is the deterministic `IStorageService` (real 2-arg `createTemporaryUrl(path, expiresIn)`, optional `failFor` set) for signing-dependent artwork specs -- distinct from `test/shared/in-memory-storage.ts` (`InMemoryStorage`, the 1-arg `IKycStorageService`).
