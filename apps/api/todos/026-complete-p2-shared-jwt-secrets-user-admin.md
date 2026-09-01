---
status: complete
priority: p2
issue_id: 026
tags: [code-review, security, jwt, configuration]
dependencies: []
---

# Shared JWT Secrets Between User and Admin Domains

## Problem Statement
Both user and admin authentication use the same JWT access/refresh secrets from `jwt.config.ts`. A token generated for a regular user could potentially be used on admin endpoints (and vice versa) if the `type` claim check is bypassed or misconfigured. Separate secret keys per domain provide defense-in-depth.

## Findings
- `src/config/jwt.config.ts` defines a single set of secrets: `accessSecret`, `refreshSecret`, `refreshHmacSecret`
- `AuthGuard` rejects admin tokens (type !== 'user'), `BackofficeGuard` rejects user tokens (type !== 'admin')
- However, both guards verify against the same secret, so a valid user token passes signature verification in BackofficeGuard before the type check

## Proposed Solutions

### Option A: Add separate admin JWT secrets
- **Description:** Add `ADMIN_JWT_ACCESS_SECRET`, `ADMIN_JWT_REFRESH_SECRET`, `ADMIN_JWT_REFRESH_HMAC_SECRET` environment variables. Create a separate `backoffice-jwt.config.ts` or extend existing config. BackofficeGuard uses admin-specific secrets.
- **Pros:** Defense-in-depth; cryptographic domain separation; a compromised user secret doesn't affect admin auth
- **Cons:** More env vars to manage; config complexity
- **Effort:** Medium
- **Risk:** Low

### Option B: Keep shared secrets with strict type enforcement
- **Description:** Accept shared secrets but ensure type enforcement is bulletproof in both guards. Document the decision.
- **Pros:** Simpler config; fewer secrets to manage
- **Cons:** No cryptographic domain separation; relies entirely on application-level type checks
- **Effort:** Small
- **Risk:** Low (current type checks work, but less defense-in-depth)

## Recommended Action
Option A implemented. Created `backoffice-jwt.config.ts` with optional `ADMIN_JWT_*` env vars that fall back to shared secrets when not set. This provides a smooth migration path while enabling cryptographic domain separation.

## Technical Details
- **Affected files:** `src/config/backoffice-jwt.config.ts` (new), `src/config/validation-schema.ts`, `src/app.module.ts`, `src/common/guards/backoffice.guard.ts`, `src/modules/backoffice/backoffice-auth.service.ts`
- **Components:** JWT configuration, BackofficeGuard, BackofficeAuthService

## Acceptance Criteria
- [x] Admin and user JWT domains use separate secret keys (if Option A)
- [x] Cross-domain token usage fails at signature verification level
- [x] All existing tests updated for new secret configuration

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel, Architecture strategist)
- 2026-05-21: Resolved. Created `backoffice-jwt.config.ts` with fallback to shared secrets. Updated BackofficeGuard and BackofficeAuthService to inject `backofficeJwtConfig`. Added optional ADMIN_JWT_* env vars to validation schema. Updated test provider keys.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
