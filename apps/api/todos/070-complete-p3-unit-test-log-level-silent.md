---
status: complete
priority: p3
issue_id: "070"
tags: [code-review, testing, logging]
dependencies: []
---

# Add LOG_LEVEL: silent to unit test vitest config

## Problem Statement

`vitest.config.e2e.ts` and `vitest.config.integration.ts` both set `LOG_LEVEL: 'silent'`, but the unit test config `vitest.config.ts` does not. Unit tests produce noisy Logger output (warn messages from failure test cases).

## Findings

- File: `vitest.config.ts` — missing `env` block with `LOG_LEVEL: 'silent'`
- Unit test output shows warn/error log lines from mocked auth failure scenarios
- Flagged by: pattern-recognition-specialist

## Proposed Solutions

### Option 1: Add LOG_LEVEL: silent to vitest.config.ts

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `vitest.config.ts` has `LOG_LEVEL: 'silent'` in env block
- [ ] Unit tests produce no log noise
- [ ] All tests pass

## Work Log

| Date | Action | Result |
|------|--------|--------|
| 2026-06-03 | Identified during PR #9 code review | Inconsistency with e2e/integration configs |
| 2026-06-03 | Fixed: added LOG_LEVEL: 'silent' env block to vitest.config.ts | Consistent with e2e and integration configs |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/9
