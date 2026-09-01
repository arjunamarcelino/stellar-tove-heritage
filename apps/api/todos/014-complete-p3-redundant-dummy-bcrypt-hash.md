---
status: complete
priority: p3
issue_id: 014
tags: [code-review, security, quality]
dependencies: []
---

# Redundant Dummy Bcrypt Hash in Login

## Problem Statement
`src/modules/auth/auth.service.ts` lines 47 and 52 - login() runs a dummy `bcrypt.hash` when the user is not found, to prevent timing attacks. The implementation uses a magic string with no explanation of its purpose.

## Findings
- `src/modules/auth/auth.service.ts`: login() calls `bcrypt.hash('dummy-password', 12)` inline
- The timing-attack mitigation pattern is correct but not self-documenting
- The hash call is duplicated for both "not found" and "inactive" user cases

## Proposed Solutions

### Option A: Extract to Named Constant
- **Description:** Pre-compute a bcrypt hash, store it as a named constant (TIMING_SAFE_DUMMY_HASH), and use bcrypt.compare against it with a descriptive comment.
- **Pros:** Self-documenting; single source of truth; compare is slightly cheaper than hash
- **Cons:** Minor change
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Extract to Named Constant

## Implemented Solution

Extracted the dummy hash to a module-level `TIMING_SAFE_DUMMY_HASH` constant with a multi-line comment explaining the timing-attack mitigation strategy. Replaced `bcrypt.hash('dummy-password', 12)` with `bcrypt.compare(dto.password, TIMING_SAFE_DUMMY_HASH)` — this is both more descriptive and marginally more efficient (compare vs hash).

**Before:**
```typescript
if (!user) {
  await bcrypt.hash('dummy-password', 12);
  throw new UnauthorizedException('Invalid email or password');
}
```

**After:**
```typescript
const TIMING_SAFE_DUMMY_HASH = '$2b$12$LJ3m4ys3Lf...';

if (!user) {
  await bcrypt.compare(dto.password, TIMING_SAFE_DUMMY_HASH);
  throw new UnauthorizedException('Invalid email or password');
}
```

### Commit
`8ae8dd8` — `refactor(auth): extract timing-safe dummy hash to named constant`

## Technical Details
- **Affected Files:** src/modules/auth/auth.service.ts
- **Components:** AuthService

## Acceptance Criteria
- [x] Dummy hash is extracted to a named constant with a descriptive name
- [x] A comment or JSDoc explains the timing-attack mitigation purpose
- [x] Code is self-documenting without needing external context
- [x] Login behavior remains identical (timing-safe comparison still runs on invalid users)

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (named constant). Commit `8ae8dd8` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
