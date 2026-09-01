---
status: pending
priority: p2
issue_id: "049"
tags: [code-review, quality, duplication]
dependencies: []
---

# isStageEffectivelyActive Logic Duplicated in 2 Services

## Problem Statement

The logic for determining if a stage is "effectively active" (isActive && (!startsAt || startsAt <= now)) is duplicated in `UserStagesService` and `SubmissionsService`. This should live in a single place.

## Findings

- `src/modules/stages/stages.service.ts` — inline check in `getUserProgress()`
- `src/modules/submissions/submissions.service.ts` — similar check in `submit()`
- Both check `stage.isActive` and `stage.startsAt` with slightly different patterns
- Identified by: code-simplicity-reviewer (MEDIUM)

## Proposed Solutions

### Option 1: Add method to Stage entity (Recommended)

**Approach:** Add `get isEffectivelyActive(): boolean` getter to the Stage entity class.

**Pros:**
- Domain logic lives on the domain object
- Available everywhere the entity is used
- Self-documenting

**Effort:** Small | **Risk:** Low

---

### Option 2: Shared utility function

**Approach:** Create `isStageEffectivelyActive(stage: Stage): boolean` in common utils.

**Pros:**
- Works without modifying entity

**Cons:**
- Less discoverable than entity method

**Effort:** Small | **Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/backoffice/stages/entities/stage.entity.ts` — add getter
- `src/modules/stages/stages.service.ts` — use entity getter
- `src/modules/submissions/submissions.service.ts` — use entity getter

## Acceptance Criteria

- [ ] Single source of truth for "effectively active" logic
- [ ] Both services use the shared implementation
- [ ] Unit tests cover the getter/utility

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
