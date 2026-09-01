---
status: complete
priority: p3
issue_id: "052"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Unused Repository Methods: findByOrder, findByStageIdAndOrder, findByUserAndMission

## Problem Statement

Three custom repository methods are defined in interfaces and implementations but never called by any service.

## Findings

- `StageRepository.findByOrder()` — interface defined, implemented, never called
- `MissionRepository.findByStageIdAndOrder()` — same
- `SubmissionRepository.findByUserAndMission()` — same
- These were likely created anticipating future use (YAGNI)
- Identified by: code-simplicity-reviewer (LOW)

## Proposed Solutions

### Option 1: Remove unused methods

**Approach:** Delete from interfaces, implementations, and test mocks.

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] No unused repository methods
- [ ] Interfaces, implementations, and test mocks updated
- [ ] All tests pass

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
