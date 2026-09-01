---
status: complete
priority: p3
issue_id: 076
tags: [code-review, security, swagger]
dependencies: []
---

# Unauthenticated Backoffice OpenAPI JSON Served in Production

## Problem Statement
In the non-development branch of `main.ts`, the backoffice OpenAPI spec is served via `httpAdapter.get('/${backofficeApiPrefix}/docs/json', ...)` with no guard — `httpAdapter.get` bypasses Nest guards entirely. This exposes the full privileged admin API surface (every admin path, params, DTOs) to anonymous callers, aiding reconnaissance. Equivalent data was already exposed pre-PR via the single combined `/api/v1/docs/json`, so this is a relocation rather than a brand-new leak — but a dedicated, discoverable `.../backoffice/v1/docs/json` for the admin surface is worth locking down.

## Findings
- `src/main.ts` (non-dev branch) — two unguarded `httpAdapter.get(... /docs/json ...)` handlers; the backoffice one maps the privileged surface.
- Swagger UI (`/docs/public`, `/docs/backoffice`) is correctly gated to `development` — only the JSON specs are exposed in non-dev.
- Flagged by security-sentinel (P3).

## Proposed Solutions

### Option A: Do not serve the backoffice spec in production
- **Description:** Only serve `docs/json` (both) in non-production, or serve only the public spec in production and drop the backoffice JSON entirely.
- **Pros:** Removes the admin-surface disclosure.
- **Cons:** No prod machine-readable backoffice spec (usually fine).
- **Effort:** Small
- **Risk:** Low

### Option B: Require an internal token / IP allowlist for the backoffice spec
- **Description:** Gate the backoffice `docs/json` route behind a shared secret header or network allowlist.
- **Pros:** Keeps the spec available to internal tooling.
- **Cons:** More config; secret management.
- **Effort:** Small-Medium
- **Risk:** Low

## Recommended Action
Option A — do not serve the backoffice spec in production (user-confirmed).

## Implemented Solution
Applied **Option A**: in the non-development branch of `main.ts`, only the PUBLIC spec JSON is
served (`/${apiPrefix}/docs/json`). The backoffice `docs/json` handler was removed, so the
privileged admin surface is no longer anonymously reachable in production. The `backofficeDocument`
is still built and served as Swagger UI in development (`/docs/backoffice`).

## Technical Details
- Changed: `src/main.ts` (removed the non-dev backoffice `docs/json` route).

## Acceptance Criteria
- [x] The backoffice OpenAPI JSON is not anonymously reachable in production (removed).
- [x] Dev Swagger UX unchanged (both `/docs/public` and `/docs/backoffice` UIs still gated to development).

## Work Log
- 2026-07-01: Filed from PR #17 review (security-sentinel). Noted pre-existing equivalent exposure via combined docs/json.
- 2026-07-01: Resolved via Option A. Prod-mode smoke test: `GET /api/v1/docs/json` → 200, `GET /api/backoffice/v1/docs/json` → 404, `GET /docs/backoffice` → 404.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
