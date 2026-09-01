---
status: complete
priority: p3
issue_id: 020
tags: [code-review, testing, quality]
dependencies: []
---

# Test Setup Duplication

## Problem Statement
`test/e2e/auth.e2e-spec.ts` duplicates the `truncateTables` logic that already exists in `test/integration/setup.ts`. Changes must be synchronized manually.

## Findings
- `test/e2e/auth.e2e-spec.ts`: inline truncateTables implementation
- `test/integration/setup.ts`: canonical truncateTables implementation
- Both perform identical table truncation logic

## Proposed Solutions

### Option A: Extract to Shared Test Utility
- **Description:** Create `test/shared/helpers.ts` exporting `truncateTables`. Both test layers import from there.
- **Pros:** Single source of truth; easy to extend
- **Cons:** Adds a new file
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Extract to Shared Test Utility

## Implemented Solution

Created `test/shared/helpers.ts` with the canonical `truncateTables` function. Updated `test/integration/setup.ts` to re-export from shared. Updated `test/e2e/auth.e2e-spec.ts` to import from shared and use the helper in `beforeEach`.

### Commit
`e2cf9b6` — `refactor(test): extract truncateTables to shared test helper`

## Technical Details
- **Affected Files:** test/shared/helpers.ts (new), test/integration/setup.ts, test/e2e/auth.e2e-spec.ts
- **Components:** E2E test setup, integration test setup, test utilities

## Acceptance Criteria
- [x] `truncateTables` is defined in exactly one shared location
- [x] Both e2e and integration test setups import from the shared location
- [x] All test suites continue to pass after the refactor
- [x] Any future test utility functions have a clear place to live

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (shared helpers). Commit `e2cf9b6` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
