---
status: complete
priority: p2
issue_id: "072"
tags: [code-review, performance]
dependencies: []
---

# Parallelize Count Queries in getUserProgress

## Problem Statement
`getUserProgress()` in `src/modules/stages/stages.service.ts` runs three queries sequentially: `findAll(stages)` then `countActiveMissionsByStageIds` then `countCompletedMissionsByStageIds`. The last two queries are independent of each other (both only depend on `stageIds`) and should run in parallel. This is especially impactful because `getCurrentStage()` — now called on every profile request — delegates to `getUserProgress()`, making the profile endpoint's critical path 4 sequential queries when it could be 3.

## Findings
- **Performance Oracle agent**: Sequential queries negate most of the `Promise.all` benefit in `AuthService.getProfile()`. The two count queries can be parallelized with a 2-line change, reducing the sequential chain from 3 to 2 queries. Estimated 30-40% latency reduction on the stage computation path.
- This also benefits the existing `GET /api/v1/stages` endpoint which calls `getUserProgress()` directly.

## Proposed Solutions

### Option A: Wrap count queries in Promise.all (Recommended)
- **Description:** Change lines 30-34 of `stages.service.ts` to run both count queries concurrently.
- **Pros:** 2-line change, reduces sequential queries from 3 to 2, benefits all callers of `getUserProgress`.
- **Cons:** Temporarily uses 2 connections instead of 1 during the parallel phase.
- **Effort:** Small
- **Risk:** None

```typescript
const [missionCounts, completedCounts] = await Promise.all([
  this.missionRepository.countActiveMissionsByStageIds(stageIds),
  this.submissionRepository.countCompletedMissionsByStageIds(userId, stageIds),
]);
```

## Recommended Action
Option A — trivial change with clear performance benefit.

## Implemented Solution
Wrapped both count queries in `Promise.all` in both `getUserProgress` and `getStageDetail` methods. Both methods now run `countActiveMissionsByStageIds` and `countCompletedMissionsByStageIds` concurrently.

## Technical Details
- **File:** `src/modules/stages/stages.service.ts:30-34`
- **Components:** UserStagesService.getUserProgress

## Acceptance Criteria
- [ ] `countActiveMissionsByStageIds` and `countCompletedMissionsByStageIds` run in `Promise.all`
- [ ] All existing tests pass unchanged
- [ ] `getUserProgress` and `getCurrentStage` both benefit

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-05 | Created from PR #12 review | Performance Oracle flagged sequential queries |
| 2026-06-05 | Fixed: Promise.all in both getUserProgress and getStageDetail | All 169 tests pass |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/12
