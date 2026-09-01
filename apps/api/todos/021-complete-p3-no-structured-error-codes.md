---
status: complete
priority: p3
issue_id: 021
tags: [code-review, api-design, quality]
dependencies: []
---

# No Structured Error Codes in API Responses

## Problem Statement
API error responses use HTTP status codes and text messages but no machine-readable error codes. Clients must parse error messages to distinguish between error types within the same HTTP status code.

## Findings
- `src/common/filters/all-exceptions.filter.ts`: no `errorCode` field in responses
- Clients have no reliable way to distinguish error types (e.g., "invalid password" vs "expired token" for 401)

## Proposed Solutions

### Option A: Error Code Enum with Global Filter Mapping
- **Description:** Define an `ErrorCode` enum and include an `errorCode` field in all error responses. Map HTTP status codes to default error codes in the exception filter.
- **Pros:** Stable API contract; enables precise client-side error handling; supports i18n
- **Cons:** Requires maintaining an error code catalog
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Error Code Enum with Global Filter Mapping

## Implemented Solution

Created `src/common/enums/error-code.enum.ts` with codes for auth, users, validation, and general errors. Updated the exception filter with a `resolveErrorCode()` method that maps HTTP status codes to appropriate ErrorCode values. Every error response now includes an `errorCode` field.

```typescript
export enum ErrorCode {
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_EXPIRED_TOKEN = 'AUTH_EXPIRED_TOKEN',
  AUTH_INVALID_REFRESH_TOKEN = 'AUTH_INVALID_REFRESH_TOKEN',
  AUTH_EMAIL_CONFLICT = 'AUTH_EMAIL_CONFLICT',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
}
```

### Commit
`5eccc12` — `feat(errors): add structured error codes to all API responses`

## Technical Details
- **Affected Files:** src/common/enums/error-code.enum.ts (new), src/common/filters/all-exceptions.filter.ts
- **Components:** AllExceptionsFilter, ErrorCode enum, error response contract

## Acceptance Criteria
- [x] An `ErrorCode` enum is defined with codes for all known error scenarios
- [x] All API error responses include a stable `errorCode` field
- [x] The global exception filter maps exceptions to appropriate error codes
- [x] Existing HTTP status codes and messages remain unchanged (additive change)
- [ ] API documentation or types are updated to reflect the new `errorCode` field

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (ErrorCode enum + filter mapping). Commit `5eccc12` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
