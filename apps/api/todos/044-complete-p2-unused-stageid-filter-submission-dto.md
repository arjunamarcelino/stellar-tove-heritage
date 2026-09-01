---
status: complete
priority: p2
issue_id: "044"
tags: [code-review, quality, dead-code]
dependencies: []
---

# stageId Filter in SubmissionFilterDto Declared But Never Used

## Problem Statement

`SubmissionFilterDto` declares a `stageId` field but `BackofficeSubmissionsService.findAll()` never uses it in the query `where` clause. This is dead code that misleads API consumers.

## Findings

- `src/modules/backoffice/submissions/dto/submission-filter.dto.ts` — has `stageId?: string`
- `src/modules/backoffice/submissions/submissions.service.ts:findAll()` — only uses `missionId`, `status`, `userId` from filters
- `stageId` is silently ignored
- Identified by: performance-oracle, data-integrity-guardian, pattern-recognition-specialist

## Proposed Solutions

### Option 1: Implement the filter (Recommended if useful)

**Approach:** Add stageId filtering via a JOIN or subquery on missions table.

**Effort:** Small | **Risk:** Low

---

### Option 2: Remove the unused field

**Approach:** Delete `stageId` from `SubmissionFilterDto`.

**Effort:** Small | **Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/backoffice/submissions/dto/submission-filter.dto.ts`
- `src/modules/backoffice/submissions/submissions.service.ts` (if implementing)

## Acceptance Criteria

- [ ] stageId filter either works or is removed
- [ ] No dead code in DTO

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
