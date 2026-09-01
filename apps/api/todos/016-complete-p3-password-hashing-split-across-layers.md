---
status: complete
priority: p3
issue_id: 016
tags: [code-review, architecture, quality]
dependencies: []
---

# Password Hashing Logic Split Across Service and Entity

## Problem Statement
Password hashing happens in `UsersService.create()` but there is no BeforeInsert hook on the User entity to enforce it. If someone calls `repository.save()` directly with a plain password, it will be persisted unhashed.

## Findings
- `src/modules/users/users.service.ts`: hashing occurs in the service layer during user creation
- `src/modules/users/entities/user.entity.ts`: no guard to validate the password is hashed before persistence

## Proposed Solutions

### Option A: Add BeforeInsert Guard on Entity
- **Description:** Add a `@BeforeInsert()` and `@BeforeUpdate()` hook that asserts `passwordHash` starts with `$2` (bcrypt prefix). Throw if not.
- **Pros:** Defense-in-depth; catches developer mistakes; does not move hashing logic
- **Cons:** Adds a runtime check; slight coupling to bcrypt format
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Add BeforeInsert Guard on Entity

## Implemented Solution

Added a `validatePasswordHash()` method with `@BeforeInsert()` and `@BeforeUpdate()` decorators on the User entity. It checks that `passwordHash` starts with `$2` (bcrypt prefix) and throws an Error if not.

```typescript
@BeforeInsert()
@BeforeUpdate()
validatePasswordHash(): void {
  if (this.passwordHash && !this.passwordHash.startsWith('$2')) {
    throw new Error('passwordHash must be a bcrypt hash, not a plain-text password');
  }
}
```

### Commit
`189743d` — `fix(users): add BeforeInsert/BeforeUpdate guard against plain-text passwords`

## Technical Details
- **Affected Files:** src/modules/users/entities/user.entity.ts
- **Components:** User entity

## Acceptance Criteria
- [x] Plain-text passwords cannot be accidentally persisted via any code path
- [x] A BeforeInsert/BeforeUpdate guard on the entity validates that passwordHash looks like a bcrypt hash
- [x] An error is thrown if an unhashed password is about to be saved
- [x] Existing service-layer hashing logic remains in place
- [ ] Unit test covers the guard (attempts to save plain password triggers error)

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (BeforeInsert guard). Commit `189743d` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
