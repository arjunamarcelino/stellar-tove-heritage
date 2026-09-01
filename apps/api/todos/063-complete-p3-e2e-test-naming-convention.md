---
status: complete
priority: p3
issue_id: "063"
tags: [code-review, testing, conventions]
dependencies: []
---

# E2E test file naming convention mismatch

## Problem Statement

The E2E test file is named `backoffice-dashboard.spec.ts` but the project convention documented in `test/CLAUDE.md` is `{feature}.e2e-spec.ts`. The vitest e2e config glob `test/e2e/**/*.spec.ts` matches both patterns, so this works but breaks naming consistency.

## Findings

- **Source:** TypeScript Reviewer
- **File:** `test/e2e/backoffice-dashboard.spec.ts`
- **Convention:** `test/CLAUDE.md` specifies `{feature}.e2e-spec.ts`

## Proposed Solutions

### Option A: Rename to match convention (Recommended)
Rename to `test/e2e/backoffice-dashboard.e2e-spec.ts`
- **Pros:** Consistent with documented convention
- **Cons:** None
- **Effort:** Small
- **Risk:** None

## Recommended Action

Option A

## Technical Details

- **Affected files:** `test/e2e/backoffice-dashboard.spec.ts`

## Acceptance Criteria

- [x] File renamed to `backoffice-dashboard.e2e-spec.ts`
- [x] Vitest e2e config still picks it up

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-03 | Created from PR #8 review | Note: file was originally `.e2e-spec.ts` but renamed due to vitest CLI filter issue — the glob still matches both patterns |
| 2026-06-03 | Fixed: renamed to `backoffice-dashboard.e2e-spec.ts` | Convention restored |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/8
