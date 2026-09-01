---
status: complete
priority: p2
issue_id: 006
tags: [code-review, architecture, configuration]
dependencies: []
---

# ThrottlerModule Reads process.env Directly

## Problem Statement
In `src/app.module.ts` lines 33-34, the ThrottlerModule reads `process.env.THROTTLE_TTL` and `process.env.THROTTLE_LIMIT` directly instead of using the ConfigService/registerAs pattern used by every other configuration in the application. This bypasses Joi validation entirely, meaning missing or invalid throttle values will not be caught at startup. It also creates an inconsistency in configuration management that makes the codebase harder to maintain.

## Findings
- `src/app.module.ts` lines 33-34: `process.env.THROTTLE_TTL` and `process.env.THROTTLE_LIMIT` are read directly.
- `src/config/validation-schema.ts` lines 32-33: Joi validation rules already exist for `THROTTLE_TTL` and `THROTTLE_LIMIT` but they are bypassed by direct `process.env` access.
- All other environment variables (database, JWT, Redis, etc.) use the `registerAs` configuration pattern with Joi validation.

## Proposed Solutions

### Option A: Create throttle.config.ts with registerAs pattern
- **Description:** Create a `src/config/throttle.config.ts` file using `registerAs('throttle', ...)`. Inject via `throttleConfig.KEY` in ThrottlerModule.forRootAsync().
- **Pros:** Consistent with existing patterns; Joi validates values at startup; centralized configuration; testable.
- **Cons:** Slightly more code than direct process.env access.
- **Effort:** Small
- **Risk:** Low

### Option B: Add validation but keep inline config
- **Description:** Continue using process.env in the module but use ThrottlerModule.forRootAsync() with useFactory that injects ConfigService.
- **Pros:** Adds validation; less file creation than Option A.
- **Cons:** Still inconsistent with registerAs pattern used elsewhere; configuration logic split across files.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A: Create throttle.config.ts with registerAs pattern

## Implemented Solution

Implemented **Option A** — created `throttle.config.ts` with the `registerAs` pattern:

### 1. New `throttle.config.ts` created (`src/config/throttle.config.ts`)
```typescript
export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
}));
```

### 2. `AppModule` updated (`src/app.module.ts`)
- Added `throttleConfig` to the `ConfigModule.forRoot({ load: [...] })` array.
- Replaced `ThrottlerModule.forRoot([...])` with `ThrottlerModule.forRootAsync()` injecting `throttleConfig.KEY`.
- Consolidated duplicate `@nestjs/config` imports.

**Before:**
```typescript
ThrottlerModule.forRoot([
  {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
]),
```

**After:**
```typescript
ThrottlerModule.forRootAsync({
  inject: [throttleConfig.KEY],
  useFactory: (tCfg: ConfigType<typeof throttleConfig>) => ([
    { ttl: tCfg.ttl, limit: tCfg.limit },
  ]),
}),
```

### Commit
`7f48ff6` — `fix(config): use registerAs for throttle config instead of raw process.env`

## Technical Details
- **Affected Files:** src/app.module.ts, src/config/throttle.config.ts (new)
- **Components:** ThrottlerModule, Configuration, Joi Validation

## Acceptance Criteria
- [x] No direct `process.env` access in `src/app.module.ts`
- [x] THROTTLE_TTL and THROTTLE_LIMIT are validated by Joi at startup
- [x] ThrottlerModule uses ConfigService to read throttle configuration
- [x] Application fails fast with a clear error if throttle env vars are missing or invalid
- [x] Existing rate limiting behavior is unchanged

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (throttle.config.ts with registerAs). Commit `7f48ff6` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
