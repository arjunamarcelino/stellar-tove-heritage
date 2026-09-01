---
status: complete
priority: p3
issue_id: "069"
tags: [code-review, quality]
dependencies: []
---

# Remove unused LoggerConfig type export

## Problem Statement

`src/config/logger.config.ts` exports `LoggerConfig` type alias, but it is never imported anywhere. The injection site in `app.module.ts` uses `ConfigType<typeof loggerConfig>` instead.

## Findings

- File: `src/config/logger.config.ts`, line 9
- `export type LoggerConfig = ReturnType<typeof loggerConfig>;` — dead export
- Flagged by: kieran-typescript-reviewer, code-simplicity-reviewer

## Proposed Solutions

### Option 1: Remove the export

**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] Unused type export removed
- [ ] Build passes

## Work Log

| Date | Action | Result |
|------|--------|--------|
| 2026-06-03 | Identified during PR #9 code review | Dead code confirmed |
| 2026-06-03 | Fixed: removed unused LoggerConfig type export from logger.config.ts | File now exports only the config factory |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/9
