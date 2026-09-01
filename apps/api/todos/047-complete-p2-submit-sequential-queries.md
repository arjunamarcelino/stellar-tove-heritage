---
status: complete
priority: p2
issue_id: "047"
tags: [code-review, performance]
dependencies: []
---

# submit() Has 5 Sequential Queries — Parallelize With Promise.all

## Problem Statement

`SubmissionsService.submit()` executes 5 database queries sequentially: findMission, findStage, findAccepted, findPending, then create+save. The first 4 reads are independent and could run in parallel.

## Findings

- `src/modules/submissions/submissions.service.ts:submit()` — await on each query serially
- `findMission` and `findStage` are independent (stage lookup depends on mission.stageId, so partially dependent)
- `findAccepted` and `findPending` are independent of each other (both depend on mission existing)
- At minimum: after getting the mission, `findStage + findAccepted + findPending` can be parallelized
- Identified by: performance-oracle (CRITICAL-2)

## Proposed Solutions

### Option 1: Promise.all for independent queries (Recommended)

**Approach:** After fetching the mission, run `Promise.all([findStage, findAccepted, findPending])`.

**Pros:**
- ~3x faster for the check phase
- No logic changes

**Cons:**
- Slightly more complex error handling

**Effort:** Small

**Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/submissions/submissions.service.ts:submit()`

## Acceptance Criteria

- [ ] Independent queries run in parallel
- [ ] All validation logic preserved
- [ ] Unit tests still pass

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
