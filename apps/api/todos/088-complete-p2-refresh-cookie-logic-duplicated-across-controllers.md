---
status: complete
priority: p2
issue_id: 088
tags: [code-review, security, quality, tov-20]
dependencies: []
---

# Refresh-Cookie Logic Duplicated Across `AuthController` and `Sep10Controller` (Security-Drift Risk)

## Problem Statement
`Sep10Controller` re-declares `REFRESH_COOKIE_NAME` and inlines the exact cookie options
(`httpOnly`, `secure`, `sameSite`, `path: /${apiPrefix}/auth/refresh`, `maxAge`) that
`AuthController.setRefreshCookie` already owns. `AuthController.logout` repeats the same options a third
time for `clearCookie`. The refresh-cookie path is a security contract (path scoping + `secure` + `sameSite`)
that must match `POST auth/refresh`; three copies can silently diverge (e.g., if the path or `maxAge`
changes in one place).

## Findings
- `src/modules/auth/sep10.controller.ts:14,45-51` — duplicated const + cookie block.
- `src/modules/auth/auth.controller.ts:28,114-122` — `setRefreshCookie`.
- `src/modules/auth/auth.controller.ts:98-103` — `clearCookie` repeats the same options.

## Proposed Solutions

### Option A: Extract a shared helper/module
- **Description:** Single source of truth, e.g. `src/modules/auth/refresh-cookie.ts`:
  ```ts
  export const REFRESH_COOKIE_NAME = 'refresh_token';
  export function setRefreshCookie(res, token, app): void { ... }
  export function clearRefreshCookie(res, app): void { ... }
  ```
  Import from both controllers (both already depend on `appConfig`).
- **Pros:** One place owns the security-sensitive attributes; no drift.
- **Cons:** Minor refactor of `auth.controller`.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — one shared helper module.

## Implemented Solution
- Added `src/modules/auth/refresh-cookie.ts` exporting `REFRESH_COOKIE_NAME`, `setRefreshCookie(res, token, app)`,
  and `clearRefreshCookie(res, app)`, with a single private `baseOptions()` holding the security attributes
  (`httpOnly`, `secure`, `sameSite: 'strict'`, path-scoped to `/${apiPrefix}/auth/refresh`).
- `AuthController` now imports the helper (removed its private `setRefreshCookie` + the inline `clearCookie`
  options + the local const). `Sep10Controller` uses `setRefreshCookie` (removed its inline `res.cookie` block
  + local const). All four set sites + the logout clear now share one definition.

## Technical Details
- Added: `src/modules/auth/refresh-cookie.ts`.
- Changed: `src/modules/auth/auth.controller.ts`, `src/modules/auth/sep10.controller.ts`.

## Acceptance Criteria
- [x] Refresh-cookie name + attributes are defined once and used by set (both controllers) and clear (logout).
- [x] Existing auth + sep10 e2e (cookie set/clear/refresh) still pass (13/13).

## Work Log
- 2026-07-02: Filed from PR #20 review (architecture-strategist, kieran-typescript, code-simplicity — merged, P2).
- 2026-07-02: Fixed — extracted refresh-cookie.ts; both controllers + logout use it. Marked complete.
