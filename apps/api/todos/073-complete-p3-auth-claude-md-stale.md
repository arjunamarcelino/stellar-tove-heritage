---
status: complete
priority: p3
issue_id: "073"
tags: [code-review, documentation]
dependencies: []
---

# Update Auth Module CLAUDE.md for ProfileResponseDto

## Problem Statement
The auth module's `CLAUDE.md` at `src/modules/auth/CLAUDE.md` does not reflect the new profile behavior or `ProfileResponseDto`. The Flow section's step 5 still says "Profile: Read `request.user` from JWT (set by AuthGuard)" — it now also fetches user data and current stage progress in parallel. The DTOs section does not list `ProfileResponseDto`.

## Findings
- **Architecture Strategist agent**: Auth CLAUDE.md is stale after profile changes.
- **Pattern Recognition agent**: DTOs section missing `ProfileResponseDto`, Flow step 5 inaccurate.

## Proposed Solutions

### Option A: Update CLAUDE.md
- **Description:** Add `ProfileResponseDto` to DTOs section. Update Flow step 5 to mention parallel user + stage fetch.
- **Effort:** Small
- **Risk:** None

## Technical Details
- **File:** `src/modules/auth/CLAUDE.md`

## Acceptance Criteria
- [ ] Flow step 5 mentions fetching user data and current stage progress via `Promise.all`
- [ ] DTOs section lists `ProfileResponseDto -- extends UserResponseDto, adds currentStage`

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-05 | Created from PR #12 review | Flagged by Architecture and Pattern agents |
| 2026-06-05 | Fixed: updated Flow step 5 and DTOs section in auth CLAUDE.md | |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/12
