---
status: complete
priority: p3
issue_id: 165
tags: [code-review, security, rate-limiting, wallets, cross-cutting]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (implement now, per requester). Added `UserAwareThrottlerGuard`
(`src/common/guards/user-aware-throttler.guard.ts`) extending `ThrottlerGuard` and overriding `getTracker`
to key on the **verified JWT `sub`** (`user:{sub}`), falling back to `ip:{ip}` for anonymous/invalid-token
requests. Because the throttler runs BEFORE `AuthGuard` (request.user not yet set), the guard verifies the
bearer token itself with the same params AuthGuard uses (small deliberate double-verify; an invalid token
degrades to IP keying and is rejected downstream). Wired as the first `APP_GUARD` in `app.module.ts`
(replacing the plain `ThrottlerGuard`); updated the CLAUDE.md guard-order note. Unit test
`test/unit/common/user-aware-throttler.guard.spec.ts` covers valid-token→user key, no-header→IP, invalid
token→IP, and non-Bearer→IP. Full e2e (auth + me-wallets) green; build + lint clean.

# Per-IP vs per-user throttling on authenticated me/wallets routes

## Problem Statement
The new `POST /me/wallets/:id/primary` (and the existing add/challenge/export/delete routes) are throttled via
the global `ThrottlerGuard` using the default tracker (`req.ip`), because no custom `getTracker` override
exists. For authenticated, owner-scoped routes, per-IP keying means shared-NAT users can consume each other's
budget, and a single user behind rotating IPs is under-limited. This is **cross-cutting and pre-existing**
(not introduced by TOV-25) — the new route just inherits the platform choice. Abuse ceiling is low (a user can
only churn their own wallets' primary flag, generating audit rows), so this is P3.

## Findings
- `me-wallets.controller.ts` — `@Throttle({ default: { ttl: 60000, limit: 10 } })` on `setPrimary`/`remove`.
- No `ThrottlerGuard.getTracker` override in the repo → default `req.ip` keying.
- Consistent with every other route in this controller (add/challenge/export).

## Proposed Solutions
### Option A: Add a per-identity throttler tracker for authenticated surfaces
- Subclass `ThrottlerGuard` (or configure `getTracker`) to key on JWT `sub` when present, falling back to
  `req.ip` for anonymous routes.
- **Pros:** limits become per-identity; fairer, harder to evade. **Cons:** cross-cutting; affects all
  authenticated routes; needs its own testing. **Effort: Medium.**

### Option B: Leave as-is (per-IP)
- **Pros:** no change; low abuse ceiling for these idempotent owner-scoped ops. **Cons:** shared-NAT fairness
  + rotating-IP under-limiting persist platform-wide. **Effort: None.**

## Recommended Action
_(triage — track separately from TOV-25; platform-level)_

## Technical Details
- Files: a new guard/config under `src/common/guards` + `app.module.ts` throttler wiring (out of scope for the
  TOV-25 PR).

## Acceptance Criteria
- [ ] Decision recorded; if pursued, authenticated routes key throttling on JWT `sub`.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (security-sentinel). Cross-cutting/pre-existing — not a
  TOV-25 blocker.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
