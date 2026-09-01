---
status: complete
priority: p2
issue_id: "071"
tags: [code-review, pattern-consistency, defense-in-depth]
dependencies: []
---

# Object.assign in ProfileResponseDto Diverges from Codebase Pattern

## Problem Statement
`ProfileResponseDto.fromUserAndStage()` in `src/modules/auth/dto/profile-response.dto.ts` uses `Object.assign(new ProfileResponseDto(), user)` to copy fields from `UserResponseDto`. Every other DTO factory in the codebase uses explicit field-by-field assignment (`UserResponseDto.fromEntity`, `StageProgressDto.create`, `MissionSummaryDto.fromEntity`, `AdminResponseDto.fromEntity`, etc.). This divergence introduces a mass-assignment surface — if `UserResponseDto` ever gains internal fields, they silently propagate without explicit opt-in.

## Findings
- **Pattern Recognition agent**: Only DTO in the entire codebase using `Object.assign` for construction. Grep confirms all other DTOs use explicit assignment.
- **Security Sentinel agent**: Defense-in-depth concern — if `UsersService.findOneById()` were ever changed to return a raw entity, `Object.assign` would copy `passwordHash` and `refreshTokenHash`.
- **TypeScript Reviewer agent**: If `UserResponseDto` gains computed getters, `Object.assign` overwrites them with plain values.
- Related: todo #027 (complete) tracked the same `Object.assign` mass-assignment risk pattern previously.

## Proposed Solutions

### Option A: Explicit field assignment
- **Description:** Replace `Object.assign` with explicit property assignment for all 6 `UserResponseDto` fields plus `currentStage`.
- **Pros:** Consistent with every other DTO factory; immune to mass-assignment; safe if parent DTO evolves.
- **Cons:** More verbose (7 lines vs 2).
- **Effort:** Small
- **Risk:** None

### Option B: Keep Object.assign with test guard
- **Description:** Keep `Object.assign` but add a unit test asserting the exact set of response keys.
- **Pros:** Less code; test catches regressions.
- **Cons:** Still diverges from codebase pattern; test is a proxy, not prevention.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — matches codebase convention and eliminates the mass-assignment surface.

## Implemented Solution
Applied Option A. Replaced `Object.assign` with explicit field-by-field assignment in `ProfileResponseDto`. Also renamed factory method from `fromUserAndStage` to `create` to match codebase convention (`StageProgressDto.create`, `PaginatedResponseDto.create`). Changed `@ApiProperty({ nullable: true })` to `@ApiPropertyOptional` for consistency (resolves todo #074).

## Technical Details
- **File:** `src/modules/auth/dto/profile-response.dto.ts:13`
- **Components:** ProfileResponseDto

## Acceptance Criteria
- [ ] `fromUserAndStage` uses explicit field assignment instead of `Object.assign`
- [ ] All existing tests pass unchanged

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-05 | Created from PR #12 review | Flagged by 4 of 7 review agents |
| 2026-06-05 | Fixed: explicit field assignment, renamed to `create`, switched to `@ApiPropertyOptional` | All 169 tests pass |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/12
- Related todo: `todos/027-complete-p2-object-assign-mass-assignment.md`
