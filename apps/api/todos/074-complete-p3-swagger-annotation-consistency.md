---
status: complete
priority: p3
issue_id: "074"
tags: [code-review, pattern-consistency, swagger]
dependencies: []
---

# Use @ApiPropertyOptional for Nullable currentStage Field

## Problem Statement
`ProfileResponseDto` uses `@ApiProperty({ type: StageProgressDto, nullable: true })` for the `currentStage` field, while all other nullable fields in the codebase use `@ApiPropertyOptional()`. This is a minor naming convention inconsistency.

## Findings
- **Pattern Recognition agent**: Codebase consistently uses `@ApiPropertyOptional()` for nullable fields (`UserResponseDto.firstName`, `StageProgressDto.startsAt`, `MissionSummaryDto.description`). The new `@ApiProperty({ nullable: true })` breaks convention.

## Proposed Solutions

### Option A: Change to @ApiPropertyOptional
- **Description:** Replace `@ApiProperty({ type: StageProgressDto, nullable: true })` with `@ApiPropertyOptional({ type: StageProgressDto, nullable: true })`.
- **Effort:** Small
- **Risk:** None

## Technical Details
- **File:** `src/modules/auth/dto/profile-response.dto.ts:6`

## Acceptance Criteria
- [ ] `currentStage` uses `@ApiPropertyOptional` instead of `@ApiProperty`

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-05 | Created from PR #12 review | Pattern Recognition agent flagged inconsistency |
| 2026-06-05 | Fixed alongside todo #071 | Changed to `@ApiPropertyOptional` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/12
