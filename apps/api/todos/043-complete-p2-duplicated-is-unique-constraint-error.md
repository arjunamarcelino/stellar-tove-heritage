---
status: pending
priority: p2
issue_id: "043"
tags: [code-review, quality, duplication]
dependencies: []
---

# isUniqueConstraintError Duplicated 4 Times Across Services

## Problem Statement

The helper function `isUniqueConstraintError(error)` checking for PostgreSQL error code `23505` is copy-pasted in 4 service files. This violates DRY and increases maintenance burden.

## Findings

- `src/modules/backoffice/stages/stages.service.ts` — private `isUniqueConstraintError`
- `src/modules/backoffice/missions/missions.service.ts` — identical copy
- `src/modules/submissions/submissions.service.ts` — identical copy
- `src/modules/auth/auth.service.ts` — identical pattern (from earlier PR)
- All check `error?.code === '23505'`
- Identified by: code-simplicity-reviewer (HIGH)

## Proposed Solutions

### Option 1: Extract to common utility (Recommended)

**Approach:** Create `src/common/utils/database.utils.ts` with `export function isUniqueConstraintError(error: unknown): boolean`. Import in all 4 services.

**Pros:**
- Single source of truth
- Easy to enhance (e.g., extract constraint name from error)

**Cons:**
- None significant

**Effort:** Small

**Risk:** Low

## Technical Details

**Affected files:**
- `src/common/utils/database.utils.ts` — new file
- 4 service files — replace private methods with import

## Resources

- **PR:** #5

## Acceptance Criteria

- [ ] Single shared utility function exists
- [ ] All 4 services import from shared location
- [ ] No private `isUniqueConstraintError` methods remain
- [ ] All existing tests still pass

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
