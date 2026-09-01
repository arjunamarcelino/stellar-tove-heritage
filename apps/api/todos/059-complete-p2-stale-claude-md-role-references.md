---
status: complete
priority: p2
issue_id: "059"
tags: [code-review, documentation]
dependencies: []
---

# Stale CLAUDE.md References to Deleted Role/RolesGuard/@Roles

## Problem Statement

Four CLAUDE.md files still reference the deleted `Role` enum, `@Roles()` decorator, and `RolesGuard`. These files serve as primary developer and AI agent onboarding documentation and will actively mislead anyone reading them.

## Findings

**`CLAUDE.md` (root):**
- Global Guards section lists `RolesGuard` as guard #3 — only ThrottlerGuard and AuthGuard remain

**`src/common/CLAUDE.md`:**
- Line 9: `decorators/ # @Public(), @Roles(), @CurrentUser()` — `@Roles()` deleted, should mention `@AdminRoles()`
- Line 14: `guards/ # AuthGuard (JWT), RolesGuard (RBAC)` — `RolesGuard` deleted, should mention `BackofficeGuard`
- Line 35: Lists `RolesGuard` as guard #3

**`src/modules/CLAUDE.md`:**
- Line 29: `Controller uses @Public() / @Roles() decorators as needed` — should reference `@AdminRoles()`

**`src/modules/users/CLAUDE.md`:**
- Entity section references `role (Role enum)`
- CreateUserDto section references `role (optional)`

Identified by: pattern-recognition-specialist, code-simplicity-reviewer, architecture-strategist

## Proposed Solutions

### Option 1: Update all 4 files (Recommended)

**Approach:** Replace stale references with current architecture:
- Replace `RolesGuard` with `BackofficeGuard` where appropriate
- Replace `@Roles()` with `@AdminRoles()`
- Remove `Role` enum references
- Update global guard list to show only 2 guards
- Update User entity description to remove `role`
- Document the `@Public()` + `BackofficeGuard` pattern for backoffice controllers

- **Effort:** Small
- **Risk:** None

## Technical Details

- **Affected files:** `CLAUDE.md`, `src/common/CLAUDE.md`, `src/modules/CLAUDE.md`, `src/modules/users/CLAUDE.md`

## Acceptance Criteria

- [ ] No CLAUDE.md file references `Role` enum, `@Roles()`, or `RolesGuard`
- [ ] Global guard documentation shows only ThrottlerGuard and AuthGuard
- [ ] Backoffice guard pattern (`@Public()` + `BackofficeGuard` + `@AdminRoles()`) is documented
- [ ] User entity description updated to remove `role`
