---
status: complete
priority: p3
issue_id: 037
tags: [code-review, security, error-handling]
dependencies: []
---

# Information Disclosure in NotFoundException Messages

## Problem Statement
`AdminsService` throws `NotFoundException` with messages like `'Admin not found'` or similar that confirm the existence/non-existence of resources. For admin-related endpoints, this could help attackers enumerate valid admin IDs.

## Findings
- `src/modules/backoffice/admins.service.ts` throws `NotFoundException('Admin not found')` or similar in `findOneById`, `update`, `softDelete`
- While the global exception filter handles generic errors, HttpExceptions pass through with their original message
- For internal admin endpoints this is lower risk since they're behind auth, but still a best practice to use generic messages

## Proposed Solutions

### Option A: Use generic "Resource not found" messages (CHOSEN)
- **Description:** Replace entity-specific not found messages with generic ones like `'Resource not found'` or just use status code without message body.
- **Pros:** No information leakage; consistent error responses
- **Cons:** Slightly harder to debug (but admin ID is in the request URL anyway)
- **Effort:** Small
- **Risk:** Low

### Option B: Keep as-is (acceptable risk)
- **Description:** Since these endpoints are behind authentication and superadmin role checks, the information disclosure risk is minimal.
- **Pros:** Better developer experience; clearer error messages for debugging
- **Cons:** Minor info disclosure (acceptable behind auth)
- **Effort:** None
- **Risk:** Low

## Recommended Action
Option A implemented.

## Technical Details
- **Affected files:** `src/modules/backoffice/admins.service.ts`
- **Components:** AdminsService

## Acceptance Criteria
- [x] Error messages don't reveal internal entity type information to unauthenticated users
- [x] Authenticated admin users still get useful error context

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel)
- 2026-05-21: Resolved — replaced `Admin with id ${id} not found` with generic `Resource not found` in all 3 NotFoundException locations (findOneById, update, softDelete). Commit: df28aed

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
