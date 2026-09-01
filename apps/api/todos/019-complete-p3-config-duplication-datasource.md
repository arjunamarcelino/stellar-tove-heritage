---
status: complete
priority: p3
issue_id: 019
tags: [code-review, quality, configuration]
dependencies: []
---

# Config Duplication Between database.config.ts and data-source.ts

## Problem Statement
`src/database/data-source.ts` (CLI datasource for migrations) duplicates default values from `src/config/database.config.ts`. Changes to one file may not be reflected in the other, causing config drift between the app and migration CLI.

## Findings
- Both files define identical fallback defaults for host, port, username, password, and database
- If a default changes in one file but not the other, the migration CLI and app may connect differently

## Proposed Solutions

### Option A: Extract Shared Defaults to Constants
- **Description:** Create `src/config/database.defaults.ts` exporting shared constants.
- **Pros:** Single source of truth; changes propagate automatically
- **Cons:** Adds an extra file
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Extract Shared Defaults to Constants

## Implemented Solution

Created `src/config/database.defaults.ts` with a `DB_DEFAULTS` constant object. Updated both `database.config.ts` and `data-source.ts` to import defaults from this shared file.

### Commit
`c64ed6c` — `refactor(config): extract shared DB defaults to eliminate duplication`

## Technical Details
- **Affected Files:** src/config/database.defaults.ts (new), src/config/database.config.ts, src/database/data-source.ts
- **Components:** Database configuration, TypeORM CLI DataSource

## Acceptance Criteria
- [x] Database connection defaults are defined in exactly one place
- [x] Both the NestJS app and the TypeORM CLI DataSource use the same defaults
- [x] Changing a default value in one place is automatically reflected everywhere
- [x] Migration CLI continues to work correctly (`npm run migration:*` commands)

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (shared defaults file). Commit `c64ed6c` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
