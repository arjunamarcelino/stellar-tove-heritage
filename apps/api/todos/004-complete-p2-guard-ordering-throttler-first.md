---
status: complete
priority: p2
issue_id: 004
tags: [code-review, security, architecture]
dependencies: []
---

# Guard Ordering: ThrottlerGuard Should Run First

## Problem Statement
In `src/app.module.ts` lines 41-43, guards run in order: AuthGuard -> RolesGuard -> ThrottlerGuard. Rate limiting runs LAST, meaning unauthenticated brute-force requests still get JWT-verified before being throttled. This wastes CPU on cryptographic operations (JWT verification) for requests that should be rejected cheaply by the rate limiter. ThrottlerGuard should be first to reject floods at the lowest possible cost.

## Findings
- `src/app.module.ts` lines 41-43: APP_GUARD providers are registered in the order AuthGuard, RolesGuard, ThrottlerGuard.
- NestJS executes global guards in the order they are registered in the providers array.
- Every brute-force or flood request currently undergoes full JWT verification and role checking before the rate limiter has a chance to reject it.

## Proposed Solutions

### Option A: Reorder APP_GUARD providers
- **Description:** Move the ThrottlerGuard provider to the first position in the APP_GUARD array, before AuthGuard and RolesGuard.
- **Pros:** Minimal change; rate limiting rejects floods before any auth processing; reduces CPU load under attack.
- **Cons:** None significant; this is the standard recommended ordering.
- **Effort:** Small
- **Risk:** Low

### Option B: Extract ThrottlerGuard to middleware layer
- **Description:** Move rate limiting into a NestJS middleware that runs before the guard pipeline entirely.
- **Pros:** Even earlier rejection in the request lifecycle; clearer separation of concerns.
- **Cons:** Loses NestJS guard metadata integration (e.g., per-route throttle overrides via decorators); more code to maintain.
- **Effort:** Medium
- **Risk:** Medium

## Recommended Action
Option A: Reorder APP_GUARD providers

## Implemented Solution

Implemented **Option A** — reordered APP_GUARD providers so ThrottlerGuard runs first:

**Before:**
```typescript
providers: [
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
  { provide: APP_GUARD, useClass: ThrottlerGuard },  // runs last — floods get JWT-verified first
],
```

**After:**
```typescript
providers: [
  { provide: APP_FILTER, useClass: AllExceptionsFilter },
  { provide: APP_GUARD, useClass: ThrottlerGuard },  // runs first — rejects floods cheaply
  { provide: APP_GUARD, useClass: AuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

### Commit
`776edcd` — `fix(guards): reorder APP_GUARD providers — ThrottlerGuard first`

## Technical Details
- **Affected Files:** src/app.module.ts
- **Components:** Global Guards, ThrottlerModule, AuthModule

## Acceptance Criteria
- [x] ThrottlerGuard is the first APP_GUARD provider in the providers array
- [x] Rate limiting rejects requests before JWT verification occurs
- [x] Existing auth and role-based access control still functions correctly
- [x] Rate limit responses return 429 status code

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (reorder guards). Commit `776edcd` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
