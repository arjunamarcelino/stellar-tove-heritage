---
status: complete
priority: p1
issue_id: 024
tags: [code-review, security, jwt, authentication]
dependencies: []
---

# Missing Issuer/Audience Verification in BackofficeGuard

## Problem Statement
`BackofficeGuard` at `src/common/guards/backoffice.guard.ts:41` calls `jwtService.verifyAsync(token, { secret })` without specifying `issuer` or `audience` options. The global `AuthGuard` verifies `issuer: 'tove-api'` and `audience: 'tove-platform'`. This inconsistency means BackofficeGuard accepts tokens with any issuer/audience, potentially accepting tokens from other systems or JWT providers.

## Findings
- `src/common/guards/backoffice.guard.ts:41` - `verifyAsync` only passes `secret`, missing `issuer` and `audience`
- `src/common/guards/auth.guard.ts:43-47` correctly verifies with `{ secret, issuer: 'tove-api', audience: 'tove-platform' }`
- Both guards use the same JWT secret (`jwtConfig.accessSecret`), making cross-acceptance possible

## Proposed Solutions

### Option A: Add issuer and audience to BackofficeGuard verification
- **Description:** Add `issuer: 'tove-api'` and `audience: 'tove-platform'` to the `verifyAsync` options in BackofficeGuard, matching AuthGuard's behavior.
- **Pros:** Quick fix; consistent with existing pattern; prevents token cross-acceptance
- **Cons:** None significant
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Add issuer and audience to BackofficeGuard verification.

## Technical Details
- **Affected files:** `src/common/guards/backoffice.guard.ts`
- **Components:** BackofficeGuard

## Acceptance Criteria
- [ ] BackofficeGuard verifies issuer and audience in JWT verification
- [ ] Tokens without correct issuer/audience are rejected with 401
- [ ] Unit tests updated to verify issuer/audience checking

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel, Architecture strategist, Performance oracle)
- 2026-05-21: Fixed. Added `issuer: 'tove-api'` and `audience: 'tove-platform'` to `verifyAsync` options in BackofficeGuard, matching AuthGuard. Added unit test verifying the options are passed. Commit: 32bd10e

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
