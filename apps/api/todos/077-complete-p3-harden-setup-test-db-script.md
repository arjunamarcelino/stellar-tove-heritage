---
status: complete
priority: p3
issue_id: 077
tags: [code-review, security, tooling, data-integrity]
dependencies: []
---

# Harden scripts/setup-test-db.sh (SQL Quoting, Non-Test-DB Guard, Password)

## Problem Statement
`scripts/setup-test-db.sh` interpolates operator-supplied env vars directly into `psql -c` SQL strings, has no guard that the target is actually a test database before running migrations, and commits a default DB password. Impact is low (operator-controlled inputs, additive migrations, safe defaults), but the quoting is unsafe and "provision the test DB" could silently migrate another environment's schema if `DB_DATABASE` is pointed elsewhere.

## Findings
- `scripts/setup-test-db.sh:26-33` — `... WHERE rolname='$DB_USERNAME'` and `CREATE ROLE "$DB_USERNAME" WITH LOGIN PASSWORD '$DB_PASSWORD'` — a single quote in the value breaks out of the literal (SQL injection into the admin psql session).
- `scripts/setup-test-db.sh:20-42` — `DB_DATABASE` is env-overridable and `yarn typeorm migration:run -t each` runs against whatever it resolves to; no `*test*` guard.
- `scripts/setup-test-db.sh:21` — default `DB_PASSWORD=tove_secret` committed (acceptable for local test only).
- `CREATE ROLE`/`CREATE DATABASE` are existence-guarded (won't clobber existing objects) — good.
- Flagged by security-sentinel (P3) and data-integrity-guardian (P3).

## Proposed Solutions

### Option A: Validate inputs + add a test-DB guard
- **Description:** Validate `DB_USERNAME`/`DB_DATABASE` against `^[A-Za-z0-9_]+$` before interpolation (or pass via `psql -v` with `format('%I'/%L', ...)`); refuse to run the migration step unless `DB_DATABASE` matches `*test*` (override with an explicit `ALLOW_NONTEST_DB=1`).
- **Pros:** Closes the injection and wrong-target footguns; minimal.
- **Cons:** Slightly more script.
- **Effort:** Small
- **Risk:** Low

### Option B: Keep password out of source
- **Description:** Read `DB_PASSWORD` from env with no committed default (or a gitignored file); keep the `*test*` guard from A.
- **Pros:** No credential in repo.
- **Cons:** Requires setting the var locally.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Options A + B — validate inputs, add a non-test-DB guard, and pass values injection-safely.

## Implemented Solution
Hardened `scripts/setup-test-db.sh`:
1. **Identifier validation** — `DB_USERNAME`/`DB_DATABASE` must match `^[A-Za-z0-9_]+$` or the
   script exits before any SQL runs.
2. **Non-test-DB guard** — refuses to provision a `DB_DATABASE` whose name does not contain
   `test`, unless `ALLOW_NONTEST_DB=1` is set.
3. **Injection-safe SQL** — the role/database SQL is piped via quoted heredocs so psql performs
   variable interpolation (`:'var'` string literal, `:"var"` identifier). `psql -c` does not
   interpolate, so stdin is used. The password (the one unvalidated value) is passed as `:'pass'`
   and is safe even with quotes/`$` (verified). Default password `tove_secret` kept — a local
   test-only credential already present in `DB_DEFAULTS`.

## Technical Details
- Changed: `scripts/setup-test-db.sh`.

## Acceptance Criteria
- [x] Values with special characters cannot break out of the SQL (piped heredoc + psql vars; verified a `'`/`$` password passes through as a literal).
- [x] The script refuses a non-test `DB_DATABASE` unless `ALLOW_NONTEST_DB=1`.
- [x] Invalid identifiers are rejected before any SQL runs.
- [x] `yarn db:test:setup` still provisions `tove_test` idempotently (and creates a fresh test DB with all 10 migrations).

## Work Log
- 2026-07-01: Filed from PR #17 review (security + data-integrity reviewers).
- 2026-07-01: Hardened script (identifier validation, non-test guard, stdin/psql-var quoting). Verified: idempotent run, fresh-create runs migrations, `tove_dev` refused, `a; DROP` refused.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
