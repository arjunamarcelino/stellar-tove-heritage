---
status: complete
priority: p1
issue_id: 071
tags: [code-review, data-integrity, testing, safety]
dependencies: []
---

# Integration Tests Can TRUNCATE CASCADE a Non-Test Database

## Problem Statement
`yarn test:integration` connects to whatever `process.env.DB_DATABASE` points at (falling back to `tove_test` only when unset), then `truncateTables` runs `TRUNCATE TABLE ... CASCADE` over every entity in `beforeEach`. Unlike the e2e config — which this PR deliberately hardened to pin `DB_*` to a local `tove_test` DB — the integration vitest config pins **only** `LOG_LEVEL`. If a developer or CI has `DB_DATABASE` (or `DB_HOST`) exported to a dev/prod-like database (common while doing DB work; the same vars feed `data-source.ts` and seed scripts), running the integration suite will wipe every table in that database.

This is a data-destruction foot-gun introduced by the asymmetry: e2e was protected, integration was left exposed.

## Findings
- `vitest.config.integration.ts:15-17` — `env` block sets only `LOG_LEVEL`; no `DB_*` pinning.
- `test/integration/setup.ts:25-29` — `TypeOrmModule.forRoot` reads `process.env.DB_HOST/DB_PORT/DB_USERNAME/DB_DATABASE` directly, default `tove_test`.
- `test/shared/helpers.ts:4-9` — `truncateTables` runs `TRUNCATE TABLE "<table>" CASCADE` for every entity; called in `beforeEach` of both integration specs.
- `vitest.config.e2e.ts:16-24` — e2e pins `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE` (the protection integration lacks).
- `test/CLAUDE.md` — documents a guardrail that does **not** exist: claims integration is protected "via `ignoreEnvFile: true`". `ignoreEnvFile` only affects NestJS `ConfigModule`; the integration DB connection reads `process.env` directly and is unaffected.

## Proposed Solutions

### Option A: Pin DB env in the integration vitest config (mirror e2e)
- **Description:** Add `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE` (localhost/tove_test) to the `env` block in `vitest.config.integration.ts`. Vitest's `env` overrides `process.env` for the worker, which is exactly why e2e is safe.
- **Pros:** Trivial; removes the asymmetry; matches the already-proven e2e approach.
- **Cons:** None material.
- **Effort:** Small
- **Risk:** Low

### Option B: Add a runtime guard in truncateTables / setup
- **Description:** Throw unless the resolved database name matches `/test/` before any truncate/connection.
- **Pros:** Belt-and-suspenders; protects any future suite/script that truncates.
- **Cons:** Slightly more code; naming convention assumption.
- **Effort:** Small
- **Risk:** Low

### Option C: Both A and B, and fix the false claim in test/CLAUDE.md
- **Description:** Pin the env (A), add the `/test/` guard (B), and correct the `test/CLAUDE.md` guardrail statement.
- **Pros:** Defense in depth + accurate docs.
- **Cons:** None.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option C — pin the DB env (A) + add a name-based guard in `truncateTables` (B) + fix the docs.

## Implemented Solution
Applied **Option C** (defense in depth):

### 1. Pinned DB env in the integration vitest config (`vitest.config.integration.ts`)
Added `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_DATABASE` (localhost/`tove_test`) to the
`env` block, mirroring `vitest.config.e2e.ts`. Vitest's `env` overrides `process.env` for the
worker, so an exported `DB_DATABASE`/`DB_HOST` can no longer redirect the suite.

### 2. Name-based safety guard in `truncateTables` (`test/shared/helpers.ts`)
Before any `TRUNCATE`, the helper now throws unless `dataSource.options.database` matches
`/test/i`:
```ts
const database = String(dataSource.options.database ?? '');
if (!/test/i.test(database)) {
  throw new Error(`Refusing to TRUNCATE: database "${database}" does not look like a test database ...`);
}
```
This protects e2e, integration, and any future caller regardless of env config.

### 3. Corrected the false guardrail claim (`test/CLAUDE.md`)
Removed the inaccurate "`ignoreEnvFile: true` protects integration" statement; documented that
both vitest configs pin `DB_*` and that `truncateTables` enforces a `test`-name guard, and
clarified that `ignoreEnvFile` does not protect the DB connection (TypeORM reads `process.env`
directly).

## Technical Details
- Changed: `vitest.config.integration.ts`, `test/shared/helpers.ts`, `test/CLAUDE.md`.

## Acceptance Criteria
- [x] Integration suite cannot connect to a non-test DB even when `DB_DATABASE`/`DB_HOST` are exported in the shell.
- [x] `truncateTables` refuses to run against a database whose name does not look like a test DB.
- [x] `test/CLAUDE.md` accurately describes the actual guardrail.
- [x] `yarn test:integration` still passes (9/9); e2e still passes (36/36).

## Work Log
- 2026-07-01: Filed from PR #17 review (data-integrity-guardian). Verified the gap in `vitest.config.integration.ts` vs the hardened `vitest.config.e2e.ts`.
- 2026-07-01: Resolved via Option C. Pinned integration DB env, added `/test/i` name guard in `truncateTables`, fixed `test/CLAUDE.md`. Verified: integration 9/9, e2e 36/36 green; guard allows `tove_test`/`tove_test_probe`, refuses `tove_dev`/`tove`/`production`.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
- Precedent: `vitest.config.e2e.ts` env pinning (same PR).
