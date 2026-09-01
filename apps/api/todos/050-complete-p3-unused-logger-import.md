---
status: complete
priority: p3
issue_id: "050"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Unused Logger Import in SubmissionsService

## Problem Statement

`SubmissionsService` imports `Logger` from `@nestjs/common` but never uses it. Dead import.

## Findings

- `src/modules/submissions/submissions.service.ts` — `Logger` imported but not instantiated or called
- Identified by: code-simplicity-reviewer (LOW)

## Proposed Solutions

### Option 1: Remove the import

**Effort:** Trivial | **Risk:** None

## Acceptance Criteria

- [ ] No unused imports in SubmissionsService
- [ ] Lint passes

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
