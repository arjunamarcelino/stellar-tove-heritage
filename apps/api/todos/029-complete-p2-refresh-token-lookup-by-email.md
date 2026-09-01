---
status: complete
priority: p2
issue_id: 029
tags: [code-review, performance, security]
dependencies: []
---

# Refresh Token Lookup Uses Email Instead of ID

## Problem Statement
`BackofficeAuthService.refreshTokens()` decodes the refresh token, extracts the `sub` (admin ID), but then looks up the admin by email via `findByEmail()` instead of by ID. This adds an unnecessary index lookup and means email changes between token issuance and refresh could cause unexpected behavior.

## Findings
- `src/modules/backoffice/backoffice-auth.service.ts` in `refreshTokens()`: extracts `sub` from decoded token but calls `findByEmail(decoded.email)` instead of `findOneById(decoded.sub)`
- `findByEmail` is a string comparison (even with citext), while `findOneById` uses the primary key index
- If an admin's email is changed between login and refresh, the refresh would fail even though the token is valid

## Proposed Solutions

### Option A: Look up by ID (sub claim)
- **Description:** Replace `findByEmail(decoded.email)` with `findOneById(decoded.sub)` in the refresh flow.
- **Pros:** Faster (PK lookup); correct semantics (token identifies by ID, not email); resilient to email changes
- **Cons:** None
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented. Added `findEntityById()` method to AdminsService that returns the raw Admin entity (unlike `findOneById()` which returns AdminResponseDto). Changed `refreshTokens()` to use `findEntityById(payload.sub)`.

## Technical Details
- **Affected files:** `src/modules/backoffice/admins.service.ts`, `src/modules/backoffice/backoffice-auth.service.ts`
- **Components:** AdminsService, BackofficeAuthService

## Acceptance Criteria
- [x] Refresh token lookup uses admin ID (sub claim) not email
- [x] Refresh still works correctly after admin email change

## Work Log
- 2026-05-21: Created from PR #2 code review (Performance oracle)
- 2026-05-21: Resolved. Added `findEntityById(id)` to AdminsService. Changed `refreshTokens()` from `findByEmail(payload.email)` to `findEntityById(payload.sub)`. Updated tests.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
