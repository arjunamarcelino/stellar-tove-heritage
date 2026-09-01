---
status: complete
priority: p2
issue_id: 005
tags: [code-review, typescript, type-safety]
dependencies: []
---

# Role Type Safety in generateTokens()

## Problem Statement
In `src/modules/auth/auth.service.ts` line 102, the `generateTokens()` method accepts `role: string` instead of `role: Role`. This loses enum type safety and could allow invalid role values to be embedded in JWT payloads. Any caller could pass an arbitrary string like `"superadmin"` or a typo like `"adimn"`, and it would silently produce a token with an invalid role claim.

## Findings
- `src/modules/auth/auth.service.ts` line 102: `generateTokens()` parameter is typed as `role: string`.
- The `Role` enum exists and is used elsewhere in the codebase (e.g., RolesGuard, Role decorator).
- Callers of `generateTokens()` pass `user.role` which is typed as `Role` on the entity, but the loose `string` parameter type means the compiler cannot catch misuse from other call sites.

## Proposed Solutions

### Option A: Change parameter type to Role enum
- **Description:** Update the `role` parameter in `generateTokens()` from `string` to `Role`. Update any callers that pass a raw string to use the `Role` enum instead.
- **Pros:** Full compile-time type safety; prevents invalid roles in JWT payloads; aligns with existing enum usage.
- **Cons:** Any future callers must import and use the Role enum (this is desirable, not a real drawback).
- **Effort:** Small
- **Risk:** Low

### Option B: Add runtime validation with string type
- **Description:** Keep `role: string` but add a runtime check that validates the value against `Object.values(Role)` before embedding it in the JWT.
- **Pros:** Catches invalid roles at runtime; backward-compatible with any string-based callers.
- **Cons:** Does not provide compile-time safety; adds runtime overhead; defers error detection to execution time.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Change parameter type to Role enum

## Implemented Solution

Implemented **Option A** — changed `role: string` to `role: Role`:

- Added `import { Role } from '@common/enums/role.enum'` to `auth.service.ts`.
- Changed `generateTokens()` parameter from `role: string` to `role: Role`.

**Before:**
```typescript
private async generateTokens(
  userId: string,
  email: string,
  role: string,  // any string accepted
): Promise<{ accessToken: string; refreshToken: string }> {
```

**After:**
```typescript
private async generateTokens(
  userId: string,
  email: string,
  role: Role,  // only Role enum values accepted
): Promise<{ accessToken: string; refreshToken: string }> {
```

All callers already pass `user.role` (typed as `Role` on the User entity) or `userResponse.role` (typed as `Role` on `UserResponseDto`), so no caller changes were needed.

### Commit
`56cb6a2` — `fix(auth): use Role enum instead of string in generateTokens()`

## Technical Details
- **Affected Files:** src/modules/auth/auth.service.ts
- **Components:** AuthService, JWT token generation, Role enum

## Acceptance Criteria
- [x] `generateTokens()` accepts `Role` enum type instead of `string`
- [x] All callers pass `Role` enum values
- [x] TypeScript compiler rejects invalid string values passed as role
- [x] Existing tests pass with the updated type

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (Role enum parameter). Commit `56cb6a2` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
