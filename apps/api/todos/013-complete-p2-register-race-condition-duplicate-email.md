---
status: complete
priority: p2
issue_id: 013
tags: [code-review, reliability, database]
dependencies: []
---

# Register Race Condition on Duplicate Email

## Problem Statement
In `src/modules/auth/auth.service.ts` lines 27-30, the `register()` method checks if an email exists with `findByEmail()`, then creates the user in a separate operation. Between the check and the insert, another concurrent request could register the same email. The unique database index will catch the duplicate, but it throws an unhandled database error (likely a 500 Internal Server Error with a raw PostgreSQL constraint violation message) instead of a clean 409 ConflictException. This is a classic TOCTOU (Time Of Check, Time Of Use) race condition.

## Findings
- `src/modules/auth/auth.service.ts` lines 27-30: `register()` performs a `findByEmail()` check followed by a separate `create()` call.
- There is no transaction or locking between the existence check and the insert.
- The PostgreSQL unique constraint violation (error code 23505) is not caught, resulting in an unhandled 500 error.

## Proposed Solutions

### Option A: Catch unique constraint violation and throw ConflictException
- **Description:** Wrap the `create()` call in a try/catch. Check for PostgreSQL error code `23505` (unique_violation) and throw `ConflictException` instead.
- **Pros:** Simple; leverages database's atomic uniqueness guarantee; handles all race conditions.
- **Cons:** Relies on database-specific error codes; initial findByEmail check is redundant for the race case.
- **Effort:** Small
- **Risk:** Low

### Option B: Use a transaction with SELECT ... FOR UPDATE
- **Description:** Wrap register flow in a serializable transaction with row-level locking.
- **Pros:** Prevents race at application level.
- **Cons:** Higher complexity; FOR UPDATE requires the row to exist (incorrect for new registrations without advisory locks).
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Catch unique constraint violation and throw ConflictException

## Implemented Solution

Implemented **Option A** — catch PostgreSQL unique_violation error code 23505:

**Before:**
```typescript
async register(dto: RegisterDto): Promise<{ accessToken: string; refreshToken: string }> {
  const existing = await this.usersService.findByEmail(dto.email);
  if (existing) {
    throw new ConflictException('Email already in use');
  }

  const userResponse = await this.usersService.create({ ... });
  // If a concurrent request inserts the same email between findByEmail and create,
  // PostgreSQL throws error 23505 → unhandled 500 error
  return this.generateTokens(...);
}
```

**After:**
```typescript
async register(dto: RegisterDto): Promise<{ accessToken: string; refreshToken: string }> {
  const existing = await this.usersService.findByEmail(dto.email);
  if (existing) {
    throw new ConflictException('Email already in use');
  }

  let userResponse: UserResponseDto;
  try {
    userResponse = await this.usersService.create({ ... });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code: string }).code === '23505'
    ) {
      throw new ConflictException('Email already in use');
    }
    throw error;
  }
  return this.generateTokens(...);
}
```

The `findByEmail()` check remains for the common (non-concurrent) case to provide an early exit without attempting an insert. The `try/catch` handles the rare race condition where two concurrent requests pass the check simultaneously.

### Commit
`e310c78` — `fix(auth): catch unique constraint violation in register for race condition`

## Technical Details
- **Affected Files:** src/modules/auth/auth.service.ts
- **Components:** AuthService, User Registration, Database Constraints, Error Handling

## Acceptance Criteria
- [x] Concurrent duplicate email registrations return 409 Conflict, not 500 Internal Server Error
- [x] The error response message is user-friendly (e.g., "Email already in use")
- [x] Single (non-concurrent) duplicate email registration still returns 409 Conflict
- [x] Successful registration is unaffected by the change
- [ ] A test verifies the behavior for duplicate email constraint violations

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (catch unique_violation). Commit `e310c78` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
