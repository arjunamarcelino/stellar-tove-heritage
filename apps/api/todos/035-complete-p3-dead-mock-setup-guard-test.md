---
status: complete
priority: p3
issue_id: 035
tags: [code-review, testing, code-quality]
dependencies: []
---

# Dead Mock Setup in BackofficeGuard Test

## Problem Statement
The BackofficeGuard unit test has mock setup lines that are immediately overwritten, making them dead code that reduces test readability.

## Findings
- `test/unit/modules/backoffice/backoffice.guard.spec.ts` lines 99-102: sets up `reflector.getAllAndOverride` mock return values, then immediately resets and re-sets them on lines 105-108
- The first mock setup (lines 100-102) is never executed because `.mockReset()` on line 105 clears it

## Proposed Solutions

### Option A: Remove dead mock setup (ALREADY DONE)
- **Description:** Delete the overwritten mock setup lines (99-102) and keep only the effective setup (105-108).
- **Pros:** Cleaner test; less confusion; removes dead code
- **Cons:** None
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Already resolved during P1 fixes.

## Technical Details
- **Affected files:** `test/unit/modules/backoffice/backoffice.guard.spec.ts`
- **Components:** BackofficeGuard test

## Acceptance Criteria
- [x] No dead/overwritten mock setup in guard tests
- [x] All tests still pass

## Work Log
- 2026-05-21: Created from PR #2 code review (Simplicity reviewer)
- 2026-05-21: Resolved — dead mock setup was already cleaned during P1 guard refactoring. No additional changes needed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
