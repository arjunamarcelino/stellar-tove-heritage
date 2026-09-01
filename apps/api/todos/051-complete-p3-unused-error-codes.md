---
status: complete
priority: p3
issue_id: "051"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Unused Error Codes Added to ErrorCode Enum

## Problem Statement

Several error codes were added to the `ErrorCode` enum but are never referenced in the codebase: `STAGE_NOT_ACTIVE`, `MISSION_NOT_ACTIVE`, `OAUTH_X_NOT_CONNECTED`, `OAUTH_TOKEN_EXPIRED`.

## Findings

- `src/common/enums/error-code.enum.ts` — 4 unreferenced enum values
- Services use generic `BadRequestException` / `NotFoundException` messages instead
- Auto-verification related codes have no implementation
- Identified by: code-simplicity-reviewer (LOW)

## Proposed Solutions

### Option 1: Remove unused codes

**Approach:** Delete the 4 unused enum values. Add them back when actually needed.

**Effort:** Trivial | **Risk:** Low

## Acceptance Criteria

- [ ] No unreferenced error codes in ErrorCode enum
- [ ] Build and tests pass

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
