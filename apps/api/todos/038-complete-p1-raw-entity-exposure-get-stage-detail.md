---
status: pending
priority: p1
issue_id: "038"
tags: [code-review, security, architecture, pattern-violation]
dependencies: []
---

# Raw Entity Exposure in getStageDetail Endpoint

## Problem Statement

`UserStagesService.getStageDetail()` returns raw `Mission[]` entities directly to the user-facing API. This violates the project convention of never exposing entities directly (all other endpoints use `static fromEntity()` response DTOs). Raw entities leak `createdBy`, `updatedBy`, `verificationConfig`, and inactive missions to end users.

## Findings

- `src/modules/stages/stages.service.ts` - `getStageDetail()` returns `{ stage: StageProgressResponse, missions: Mission[] }`
- The `stage` field correctly uses `StageProgressResponse.fromEntity()`, but `missions` field returns raw entities
- Exposes admin UUIDs (`createdBy`, `updatedBy`), `verificationConfig` (internal auto-verify config), `deletedAt`
- Also returns inactive missions — no `isActive` filter applied
- Every other endpoint in the codebase uses response DTOs with `fromEntity()` — this is the only violation
- Identified by: security-sentinel, pattern-recognition-specialist, code-simplicity-reviewer

## Proposed Solutions

### Option 1: Create MissionSummaryResponse DTO (Recommended)

**Approach:** Create a user-facing `MissionSummaryResponse` DTO with `fromEntity()` that only exposes safe fields (id, title, description, order, evidenceType). Filter out inactive missions before mapping.

**Pros:**
- Follows existing project convention exactly
- Prevents information leakage
- Easy to extend later with user-specific fields (e.g., submission status)

**Cons:**
- New file to create

**Effort:** Small

**Risk:** Low

---

### Option 2: Use class-transformer @Exclude decorators on Mission entity

**Approach:** Add `@Exclude()` decorators to sensitive fields on the Mission entity.

**Pros:**
- Less code to write

**Cons:**
- Breaks the established `fromEntity()` pattern
- Affects all uses of the entity globally
- Harder to have different views for admin vs user

**Effort:** Small

**Risk:** Medium — could break backoffice endpoints

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/modules/stages/stages.service.ts:getStageDetail()` — needs to filter inactive missions and map to DTO
- `src/modules/stages/dto/` — needs new `MissionSummaryResponse` DTO
- `src/modules/stages/stages.controller.ts` — update Swagger response type

**Related components:**
- `StageProgressResponse` — existing pattern to follow
- `MissionResponse` in backoffice — admin version (has all fields)

## Resources

- **PR:** #5
- **Similar pattern:** `src/modules/stages/dto/stage-progress-response.dto.ts` (correct implementation to follow)

## Acceptance Criteria

- [ ] User-facing mission data uses a response DTO with `fromEntity()`
- [ ] `createdBy`, `updatedBy`, `verificationConfig`, `deletedAt` are NOT exposed
- [ ] Inactive missions are filtered out
- [ ] Unit tests updated
- [ ] Swagger docs reflect the response DTO

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)

**Actions:**
- Identified raw entity exposure via security-sentinel, pattern-recognition, and simplicity reviewers
- Confirmed all other endpoints use `fromEntity()` pattern
- Verified sensitive fields present on Mission entity

**Learnings:**
- Project convention is strict: never expose entities directly to users
- Admin and user APIs should have separate response DTOs
