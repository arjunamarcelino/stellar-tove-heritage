---
status: complete
priority: p2
issue_id: 032
tags: [code-review, architecture, code-quality]
dependencies: []
---

# Code Duplication Between AuthService and BackofficeAuthService

## Problem Statement
`BackofficeAuthService` duplicates ~90-100 lines of code from `AuthService`, including login flow (bcrypt compare, timing-safe checks), token generation, refresh token handling, and HMAC hashing. This means bug fixes or security improvements must be applied in two places.

## Findings
- `src/modules/backoffice/backoffice-auth.service.ts` duplicates: timing-safe login pattern, token generation with claims, refresh token HMAC hashing, token rotation logic
- `src/modules/auth/auth.service.ts` has the same patterns
- The only differences: entity type (User vs Admin), token `type` claim ('user' vs 'admin'), repository injection token, cookie name

## Proposed Solutions

### Option A: Extract shared auth utilities
- **Description:** Create a `src/common/utils/auth.utils.ts` with shared functions: `timingSafeLogin()`, `hashRefreshToken()`, `verifyRefreshToken()`. Both services import and use these utilities.
- **Pros:** DRY; bug fixes in one place; easy to test utilities independently
- **Cons:** Services still have some structural duplication; utilities need to be generic
- **Effort:** Medium
- **Risk:** Low

### Option B: Create a BaseAuthService
- **Description:** Abstract common auth logic into a base class that both `AuthService` and `BackofficeAuthService` extend. Override entity-specific methods.
- **Pros:** Maximum code reuse; consistent behavior guaranteed
- **Cons:** Inheritance can be rigid; may over-abstract for 2 services; NestJS DI with abstract classes can be tricky
- **Effort:** Medium
- **Risk:** Medium

### Option C: Accept duplication, document it
- **Description:** Keep both services independent. Add comments noting the parallel and a lint rule/test that flags drift.
- **Pros:** Simple; no abstraction overhead; services can evolve independently
- **Cons:** Ongoing risk of inconsistent security fixes; more code to maintain
- **Effort:** Small
- **Risk:** Medium (security drift)

## Recommended Action
Option A implemented. Extracted `TIMING_SAFE_DUMMY_HASH`, `hashRefreshToken()`, and `verifyRefreshToken()` to `src/common/utils/auth.utils.ts`. Both services now import from the shared module. Security-critical crypto logic is in one place with dedicated unit tests. Structural duplication (login flow, token generation) intentionally kept in each service since the domain-specific logic is sufficiently different.

## Technical Details
- **Affected files:** `src/common/utils/auth.utils.ts` (new), `src/modules/auth/auth.service.ts`, `src/modules/backoffice/backoffice-auth.service.ts`
- **Components:** AuthService, BackofficeAuthService, shared auth utilities

## Acceptance Criteria
- [x] Common auth logic is shared or explicitly documented as intentionally duplicated
- [x] Security-critical patterns (timing-safe compare, HMAC hashing) are consistent between both services

## Work Log
- 2026-05-21: Created from PR #2 code review (Simplicity reviewer, Architecture strategist, Pattern recognition)
- 2026-05-21: Resolved. Created `src/common/utils/auth.utils.ts` with `TIMING_SAFE_DUMMY_HASH`, `hashRefreshToken()`, `verifyRefreshToken()`. Updated both auth services to import from shared utils. Removed private duplicate methods. Added 9 unit tests for the shared utilities.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
