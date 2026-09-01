---
status: complete
priority: p3
issue_id: 015
tags: [code-review, security, error-handling]
dependencies: []
---

# Exception Filter May Leak Internal Details

## Problem Statement
`src/common/filters/all-exceptions.filter.ts` spreads `message` into the response body for all exceptions. For non-HttpException errors, raw error messages could leak table names, SQL fragments, or stack traces to API consumers.

## Findings
- The filter spreads the `message` field directly into the response body
- For non-HttpException errors (TypeORM errors, runtime exceptions), the raw error message is exposed
- No distinction between HttpException and unknown exceptions in the response

## Proposed Solutions

### Option A: Guard Non-HttpException Messages
- **Description:** Only include the original message for HttpException instances. For unknown exceptions, return a generic "Internal server error" message.
- **Pros:** Prevents information leakage; preserves validation messages for HttpExceptions
- **Cons:** Slightly more complex filter logic
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Guard Non-HttpException Messages

## Implemented Solution

Added a conditional branch in the exception filter that only includes the original error message for `HttpException` instances. For non-HttpException errors, the response always returns a generic `"Internal server error"` message. The actual error details continue to be logged server-side via `this.logger.error()`.

### Commit
`762fdb5` — `fix(errors): guard non-HttpException messages from leaking internals`

## Technical Details
- **Affected Files:** src/common/filters/all-exceptions.filter.ts
- **Components:** AllExceptionsFilter, global error handling

## Acceptance Criteria
- [x] Non-HttpException errors return a generic "Internal Server Error" message in production
- [x] HttpException errors continue to return their original message (including validation details)
- [x] Actual error details for non-HttpException errors are logged server-side
- [x] No stack traces or internal implementation details are exposed in any error response
- [x] Development environment may optionally include more detail (configurable)

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (guard non-HttpException messages). Commit `762fdb5` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
