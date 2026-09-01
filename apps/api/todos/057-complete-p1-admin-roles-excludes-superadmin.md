---
status: complete
priority: p1
issue_id: "057"
tags: [code-review, security, authorization]
dependencies: []
---

# @AdminRoles(AdminRole.ADMIN) Excludes SUPERADMIN from /backoffice/users

## Problem Statement

The `UsersController` uses `@AdminRoles(AdminRole.ADMIN)`, but `BackofficeGuard` checks `requiredRoles.includes(payload.role)`. Since `AdminRole.SUPERADMIN = 'superadmin'` is not included in the required roles array, SUPERADMIN users are denied access to all `/backoffice/users` endpoints with a 403 Forbidden. All other backoffice controllers use `@AdminRoles(AdminRole.SUPERADMIN)`.

This may be intentional (regular admins manage platform users, superadmins manage other things) or a bug (SUPERADMIN should have superset permissions).

## Findings

- `src/modules/users/users.controller.ts` line 39 — `@AdminRoles(AdminRole.ADMIN)`
- All other backoffice controllers use `@AdminRoles(AdminRole.SUPERADMIN)`
- `BackofficeGuard` checks strict inclusion: `requiredRoles.includes(payload.role)`
- There is no role hierarchy — SUPERADMIN does NOT automatically include ADMIN permissions
- Identified by: security-sentinel (Finding 4), pattern-recognition-specialist

## Proposed Solutions

### Option 1: Include both roles (Recommended if SUPERADMIN is a superset)

**Approach:** Allow both ADMIN and SUPERADMIN access.

```typescript
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
```

- **Pros:** SUPERADMIN retains access to all backoffice features
- **Cons:** Must be applied to every controller that uses ADMIN
- **Effort:** Small
- **Risk:** Low

### Option 2: Add role hierarchy to BackofficeGuard

**Approach:** Make the guard treat SUPERADMIN as a superset of ADMIN.

```typescript
const ROLE_HIERARCHY: Record<AdminRole, AdminRole[]> = {
  [AdminRole.SUPERADMIN]: [AdminRole.SUPERADMIN, AdminRole.ADMIN],
  [AdminRole.ADMIN]: [AdminRole.ADMIN],
};
```

- **Pros:** Centralized logic, all future controllers get it automatically
- **Cons:** More complex, may be YAGNI if there are only 2 roles
- **Effort:** Medium
- **Risk:** Low

### Option 3: Keep as-is (if intentional)

**Approach:** Document that SUPERADMIN cannot manage platform users and only ADMIN can.

- **Pros:** No code change
- **Cons:** Counterintuitive — superadmin should have more access, not less
- **Effort:** Small
- **Risk:** Confusion

## Recommended Action

Confirm with the team whether SUPERADMIN should be excluded. If not, apply Option 1.

## Technical Details

- **Affected files:** `src/modules/users/users.controller.ts`

## Acceptance Criteria

- [ ] Decision documented on whether SUPERADMIN can access `/backoffice/users`
- [ ] If yes: decorator updated to include both roles
- [ ] Verified with an e2e or integration test
