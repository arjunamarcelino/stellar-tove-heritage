---
status: complete
priority: p2
issue_id: 229
tags: [code-review, security, rate-limiting, TOV-235, PR-33]
dependencies: []
---

# Per-route throttle is effectively IP-keyed for admin tokens (not identity-keyed)

## Problem Statement
The endpoint's `@Throttle({ limit: 20, ttl: 60_000 })` is intended as a leaked-token flood backstop, but for admin tokens the global `UserAwareThrottlerGuard` fails to verify the token (it uses the USER JWT secret, admin tokens are signed with the ADMIN secret) and silently falls back to keying on IP. So the cap is per-IP, not per-admin.

## Findings
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts:29` sets the per-route throttle (controller comment even notes the IP fallback).
- `src/common/guards/user-aware-throttler.guard.ts` `getTracker` verifies with `jwtConfig.accessSecret`; admin tokens (`type:'admin'`, signed with `backofficeJwtConfig.accessSecret`) throw → fall back to `ip:<addr>`.
- Consequences: (a) a stolen admin token replayed from one host shares the 20/min bucket with all other IP traffic; (b) an attacker rotating source IPs multiplies the ceiling; (c) admins behind a shared NAT contend for one bucket. Each request can carry up to `maxBatch` on-chain mutations.

## Proposed Solutions
### Option A (recommended): make the throttler admin-identity-aware
- In `getTracker`, also try `backofficeJwtConfig.accessSecret` and key on the verified admin `sub` when `type==='admin'`. Effort: Medium (touches shared guard; regression-test user + admin paths).

### Option B: tighten this route's ceiling + document
- Lower the per-route limit for this high-privilege endpoint and document that the cap is per-IP, not per-admin, with volume alerting as the real control. Effort: Small.

## Recommended Action
**RESOLVED (Option B).** Lowered the per-route ceiling from 20→10/min and documented in the controller that the cap is per-IP (not per-admin) and is a leaked-token flood backstop, not authz — volume alerting is the real control. The shared UserAwareThrottlerGuard was intentionally NOT modified (avoids regression risk to all backoffice routes).

## Technical Details
- Affected: `src/common/guards/user-aware-throttler.guard.ts` (Option A) or the controller `@Throttle` (Option B).

## Acceptance Criteria
- [x] Per-IP nature documented in the controller; ceiling tightened to 10/min; alerting noted as the real control. (Identity-aware guard deferred as higher-risk.)

## Work Log
- 2026-07-18: created from PR #33 review (security-sentinel P2).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — tightened route ceiling + documented per-IP scope.
