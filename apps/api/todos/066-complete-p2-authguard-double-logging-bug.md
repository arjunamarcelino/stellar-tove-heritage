---
status: complete
priority: p2
issue_id: "066"
tags: [code-review, quality, logging]
dependencies: []
---

# Fix AuthGuard double-logging on non-user token type

## Problem Statement

When an admin token is used on a user endpoint, AuthGuard produces two warn log messages instead of one. The `throw new UnauthorizedException()` after the non-user token type check (line 51) is inside the try block and gets caught by the outer catch block (line 54), which logs a second misleading message.

## Findings

- File: `src/common/guards/auth.guard.ts`, lines 37-57
- When `payload.type !== 'user'`, line 50 logs `Auth denied: non-user token type [...]`
- Line 51 throws `UnauthorizedException` — but this is inside the try block
- The catch at line 54 catches it and logs `Auth denied: invalid token [...]`
- Result: two warn messages for one rejection, and the second is incorrect (the token is valid, just wrong type)
- Flagged by: architecture-strategist, pattern-recognition-specialist

## Proposed Solutions

### Option 1: Move type check outside try-catch (Recommended)

**Approach:** Restructure so JWT verification is in the try-catch, but the type check happens after.

**Pros:**
- Clean separation: try-catch handles verification errors only
- Single log line per rejection path
- No catch-block logic changes

**Cons:**
- Minor refactor of control flow

**Effort:** Small
**Risk:** Low

### Option 2: Re-throw UnauthorizedException in catch

**Approach:** Add `if (error instanceof UnauthorizedException) throw error;` at the top of the catch block.

**Pros:**
- Minimal code change (1 line)

**Cons:**
- Catch block becomes more complex
- Pattern is less obvious

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Non-user token type rejection produces exactly one warn log message
- [ ] JWT verification failure produces exactly one warn log message
- [ ] Missing token produces exactly one warn log message
- [ ] All unit tests pass

## Work Log

| Date | Action | Result |
|------|--------|--------|
| 2026-06-03 | Identified during PR #9 code review | Double-logging confirmed by architecture + pattern agents |
| 2026-06-03 | Fixed: moved type check outside try-catch (Option 1) | JWT verify in try-catch only, type check after — single log per rejection path |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/9
- File: `src/common/guards/auth.guard.ts:37-57`
