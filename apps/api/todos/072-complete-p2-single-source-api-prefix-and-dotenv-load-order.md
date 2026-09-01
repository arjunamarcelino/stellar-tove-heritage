---
status: complete
priority: p2
issue_id: 072
tags: [code-review, architecture, configuration]
dependencies: []
---

# API Prefix Defined in 3 Places + Env Load-Order Divergence

## Problem Statement
The public/backoffice route prefixes are read from `process.env` in three independent places with duplicated literal defaults, guarded only by a code comment ("Keep the defaults identical"). Two consumers are functionally coupled: `RouterModule` prefixes routes using the **constant**, while the refresh-cookie `path` and the non-dev Swagger JSON route use the **config** value. If the two defaults ever drift, the cookie `path` no longer matches the route it is issued for and refresh silently fails (hard-to-diagnose auth bug).

Separately, there is an env **load-order** hazard: `api-prefix.constant.ts` evaluates `process.env.*` at module-import time, which happens before `ConfigModule.forRoot()` runs dotenv. A `.env`-only override of `API_PREFIX`/`BACKOFFICE_API_PREFIX` is therefore seen by `appConfig` (evaluated after dotenv) but NOT by the constant (routes) — so routes register at the default while the cookie path / docs JSON use the override. Works today only because deployments pass real OS env vars, not `.env`.

## Findings
- `src/common/constants/api-prefix.constant.ts:9-10` — reads `process.env.*` at import time; used by `RouterModule` (decoration-time, pre-DI).
- `src/config/app.config.ts:6-7` — reads the same env with duplicated defaults; used for cookie `path` and docs JSON route.
- `src/config/validation-schema.ts:8` — Joi `.default('api/backoffice/v1')` (third copy; decorative for routing since the constant never sees Joi's applied default).
- Cookie path consumers: `src/modules/auth/auth.controller.ts:102,119` and `src/modules/backoffice/auth/backoffice-auth.controller.ts:118,135`.
- Flagged independently by 4 reviewers (TypeScript, architecture, pattern, simplicity).

## Proposed Solutions

### Option A: Single-source the default via the constant; ensure dotenv loads first
- **Description:** `app.config.ts` imports `PUBLIC_API_PREFIX`/`BACKOFFICE_API_PREFIX` from the constant and returns them (one literal default). Add `import 'dotenv/config'` as the very first line of `src/main.ts` so `process.env` is populated before the constants evaluate, keeping constant and config on the same values even for `.env` overrides.
- **Pros:** One source of truth; fixes both drift and load-order; small change.
- **Cons:** Introduces an explicit dotenv import in main.ts (acceptable; ConfigModule already depends on dotenv).
- **Effort:** Small
- **Risk:** Low

### Option B: Single-source only (no dotenv change)
- **Description:** Collapse the default to one location but document that `.env`-based prefix overrides are unsupported; only OS env vars work.
- **Pros:** Minimal.
- **Cons:** Leaves the `.env` load-order footgun; relies on documentation.
- **Effort:** Small
- **Risk:** Medium (silent if someone uses `.env`)

### Option C: Add a guard test
- **Description:** In addition to A, add a unit test asserting `appConfig().apiPrefix === PUBLIC_API_PREFIX` and the backoffice equivalent.
- **Pros:** Prevents regression permanently.
- **Cons:** Extra test.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — single-source the default via the constant + load `dotenv/config` first in `main.ts`.

## Implemented Solution
Applied **Option A**:

### 1. `app.config.ts` now re-exports the constants (single source)
`apiPrefix`/`backofficeApiPrefix` are set to `PUBLIC_API_PREFIX`/`BACKOFFICE_API_PREFIX`
imported from `api-prefix.constant.ts` instead of re-reading `process.env` with a duplicated
literal. Routes (RouterModule → constant) and the injected config (cookie `path`, Swagger doc
paths → app.config) can no longer drift because they resolve to the same value.

### 2. `main.ts` loads `.env` before anything else
Added `import 'dotenv/config';` as the very first line so `process.env` is populated before the
prefix constants evaluate at module-import time. A `.env`-only override of `API_PREFIX` /
`BACKOFFICE_API_PREFIX` now reaches both the routes and the config.

### 3. Updated the constant's doc comment
Documents it as the single source of truth and the reason it must read `process.env` directly
(RouterModule runs before DI). The Joi default in `validation-schema.ts` remains as an
independent startup-validation copy (separate concern).

## Technical Details
- Changed: `src/config/app.config.ts`, `src/main.ts`, `src/common/constants/api-prefix.constant.ts`.

## Acceptance Criteria
- [x] The routing/cookie prefix default literal exists in exactly one place (the constant); Joi default is a separate validation copy.
- [x] Route prefix and cookie/docs path resolve from the same value (single source), and `.env` overrides are honored via `dotenv/config` load-order.
- [x] Build + all suites still pass (unit 164, e2e 36).

## Work Log
- 2026-07-01: Filed from PR #17 review (consensus of 4 reviewers).
- 2026-07-01: Resolved via Option A — app.config re-exports the constants, main.ts imports dotenv/config first, constant comment updated. Verified build + unit 164 + e2e 36 green.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
- Convention: `src/config/CLAUDE.md` (registerAs + Joi).
