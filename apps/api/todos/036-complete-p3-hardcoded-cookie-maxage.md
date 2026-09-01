---
status: complete
priority: p3
issue_id: 036
tags: [code-review, configuration, security]
dependencies: []
---

# Hardcoded Cookie maxAge Not Synced With JWT Expiration

## Problem Statement
The backoffice auth controller hardcodes the refresh token cookie `maxAge` (likely `7 * 24 * 60 * 60 * 1000` for 7 days) rather than deriving it from the JWT refresh token expiration configuration. If the JWT expiration is changed in config, the cookie lifetime won't match.

## Findings
- `src/modules/backoffice/backoffice-auth.controller.ts` or `backoffice-auth.service.ts` sets cookie with hardcoded maxAge
- JWT refresh expiration is configurable via `jwt.config.ts` (`refreshExpiration: '7d'`)
- Mismatch could cause: cookie expires before token (user loses ability to refresh) or token expires before cookie (stale cookie sent)

## Proposed Solutions

### Option A: Derive cookie maxAge from JWT config (CHOSEN)
- **Description:** Parse the `refreshExpiration` config value (e.g., '7d') into milliseconds and use it for cookie maxAge.
- **Pros:** Single source of truth; always in sync; config-driven
- **Cons:** Needs a parsing utility for duration strings (e.g., ms package)
- **Effort:** Small
- **Risk:** Low

### Option B: Add explicit cookie expiration config
- **Description:** Add a `BACKOFFICE_COOKIE_MAX_AGE` config value alongside the JWT expiration.
- **Pros:** Explicit; can set cookie lifetime independently
- **Cons:** Two values to maintain; could still drift
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented.

## Technical Details
- **Affected files:** `src/modules/backoffice/backoffice-auth.controller.ts`, `src/common/utils/auth.utils.ts`, `src/config/backoffice-jwt.config.ts`
- **Components:** BackofficeAuthController, parseDurationMs utility, JWT configuration

## Acceptance Criteria
- [x] Cookie maxAge matches or derives from JWT refresh expiration config
- [x] Changing JWT expiration automatically updates cookie lifetime

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel)
- 2026-05-21: Resolved — added `parseDurationMs()` utility to `auth.utils.ts`, injected `backofficeJwtConfig` into controller, replaced hardcoded maxAge with `parseDurationMs(this.jwt.refreshExpiration)`. Added 5 unit tests for the utility. Commit: df28aed

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
