---
status: complete
priority: p3
issue_id: 033
tags: [code-review, code-quality, performance]
dependencies: []
---

# Duplicate Timing-Safe Login Blocks

## Problem Statement
`BackofficeAuthService.login()` has two separate bcrypt.compare calls: one for the `!admin` case (compares against dummy hash) and one for the actual password verification. These can be consolidated into a single comparison with cleaner flow control.

## Findings
- `src/modules/backoffice/backoffice-auth.service.ts` login method has: (1) if no admin found, compare against dummy hash and throw; (2) compare actual password. The `AuthService` has the same pattern.
- The dummy hash comparison is for timing-safe behavior (preventing enumeration), but the code structure is verbose

## Proposed Solutions

### Option A: Consolidate into single flow (CHOSEN)
- **Description:** Always compare the password (against dummy hash if no admin, against real hash if found). Then check the result along with admin existence in a single conditional.
- **Pros:** Cleaner code; fewer lines; still timing-safe
- **Cons:** Slightly different flow (minor)
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented.

## Technical Details
- **Affected files:** `src/modules/backoffice/backoffice-auth.service.ts`, `src/modules/auth/auth.service.ts`
- **Components:** BackofficeAuthService, AuthService

## Acceptance Criteria
- [x] Login timing is constant regardless of whether admin/user exists
- [x] Code is more concise without sacrificing readability

## Work Log
- 2026-05-21: Created from PR #2 code review (Simplicity reviewer)
- 2026-05-21: Resolved — consolidated 3 bcrypt.compare calls into 1 using `entity?.isActive ? entity.passwordHash : TIMING_SAFE_DUMMY_HASH` pattern in both services. Commit: df28aed

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
