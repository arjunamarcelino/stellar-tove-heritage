---
status: complete
priority: p1
issue_id: "039"
tags: [code-review, performance, database]
dependencies: []
---

# countActiveMissionsByStageIds Loads All Entities Instead of COUNT

## Problem Statement

`MissionRepository.countActiveMissionsByStageIds()` fetches ALL mission entities into memory, then counts them per stage using JavaScript. With many missions, this causes unnecessary memory allocation and data transfer. Should use SQL `COUNT(*) GROUP BY stage_id` instead.

## Findings

- `src/modules/stages/stages.service.ts` — `getUserProgress()` calls a method that loads full mission entities
- The service then does JS-level counting: groups by stageId and counts array lengths
- With 100 stages × 50 missions each = 5000 full entity objects loaded just to get counts
- SQL `SELECT stage_id, COUNT(*) FROM missions WHERE is_active = true AND deleted_at IS NULL GROUP BY stage_id` would return ~100 rows of two columns
- Identified by: performance-oracle (CRITICAL-1), code-simplicity-reviewer

## Proposed Solutions

### Option 1: Add countByStageIds method to MissionRepository (Recommended)

**Approach:** Add a dedicated repository method using TypeORM QueryBuilder with `SELECT stage_id, COUNT(*)` and `GROUP BY stage_id`. Return a `Map<string, number>`.

**Pros:**
- Massive reduction in data transfer and memory usage
- Clean, idiomatic SQL
- Follows repository pattern

**Cons:**
- New repository method and interface addition

**Effort:** Small

**Risk:** Low

---

### Option 2: Use TypeORM createQueryBuilder in the service directly

**Approach:** Build the count query inline in the service.

**Pros:**
- No repository changes needed

**Cons:**
- Violates repository pattern (leaks DB concerns into service)
- Harder to test

**Effort:** Small

**Risk:** Medium — pattern violation

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/modules/stages/stages.service.ts` — update `getUserProgress()` to use new method
- `src/modules/backoffice/missions/repositories/mission.repository.ts` — add `countActiveMissionsByStageIds(stageIds: string[]): Promise<Map<string, number>>`
- `src/modules/backoffice/missions/repositories/mission-repository.interface.ts` — add to interface
- `test/unit/modules/stages/stages.service.spec.ts` — update mocks

## Resources

- **PR:** #5
- **Pattern:** `countCompletedMissionsByStageIds` in SubmissionRepository already uses a similar COUNT GROUP BY pattern

## Acceptance Criteria

- [ ] Mission counting uses SQL COUNT + GROUP BY, not entity loading
- [ ] Repository method returns `Map<string, number>`
- [ ] Interface updated with new method signature
- [ ] Unit tests pass with updated mocks
- [ ] No full Mission entities loaded for counting purposes

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)

**Actions:**
- Performance oracle identified this as the most critical performance issue
- Confirmed the pattern: loads entities, iterates in JS to count
- Found existing `countCompletedMissionsByStageIds` as reference implementation

**Learnings:**
- Always use SQL aggregation for counting operations
- The submission repository already has the correct pattern to follow
