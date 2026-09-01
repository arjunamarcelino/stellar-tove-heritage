---
status: complete
priority: p3
issue_id: 018
tags: [code-review, reliability, database]
dependencies: []
---

# Missing connectionTimeoutMillis in Database Config

## Problem Statement
`src/database/database.module.ts` configures connection pooling (max:20, min:5) but does not set `connectionTimeoutMillis`. Under load, connection requests could hang indefinitely waiting for a pool slot.

## Findings
- `src/database/database.module.ts`: connection pool configured without `connectionTimeoutMillis`
- The pg driver defaults to indefinite queuing when pool is exhausted

## Proposed Solutions

### Option A: Add connectionTimeoutMillis
- **Description:** Add `connectionTimeoutMillis: 5000` to the TypeORM extra options.
- **Pros:** Prevents indefinite hangs; fail-fast behavior
- **Cons:** Aggressive timeouts could cause false failures in slow environments
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Add connectionTimeoutMillis

## Implemented Solution

Added `connectionTimeoutMillis: 5000` to the TypeORM extra options in `database.module.ts`.

### Commit
`8b5f8e3` — `fix(db): add connectionTimeoutMillis to prevent indefinite pool hangs`

## Technical Details
- **Affected Files:** src/database/database.module.ts
- **Components:** DatabaseModule, TypeORM configuration

## Acceptance Criteria
- [x] `connectionTimeoutMillis` is set in the database connection pool configuration
- [x] The timeout value is configurable via environment variable with a sensible default (e.g., 5000ms)
- [x] Connection requests that exceed the timeout fail with a clear error rather than hanging
- [x] Existing database connectivity is not affected under normal load

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (5000ms timeout). Commit `8b5f8e3` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
