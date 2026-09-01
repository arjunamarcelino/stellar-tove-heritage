---
status: complete
priority: p2
issue_id: 268
tags: [code-review, security, rate-limiting, TOV-241, PR-37]
dependencies: []
---

# GET status throttle is per-IP, not per-admin — identity-blind and infra-fragile

## Problem Statement
The `@Throttle({ default: { limit: 60, ttl: 60_000 } })` on `GET :wallet` is enforced per-IP, not per-admin. `UserAwareThrottlerGuard` verifies with the *user* JWT secret, so admin tokens fail verification and the limiter falls back to keying on IP. Two concrete consequences: (a) all admins behind a shared corporate NAT or the platform's own load-balancer egress IP share ONE 60/min bucket — normal status-pill usage can throttle everyone (self-inflicted DoS); (b) a single leaked admin token still gets a full 60/min = 3,600/hr enumeration budget with no per-identity ceiling. If `X-Forwarded-For` trust is misconfigured at the proxy, the bucket is either globally collapsed (all traffic = one IP) or spoofable (limit bypassed).

## Findings
Flagged by **security-sentinel (P2)**. Same keying nuance as the POST route (documented at `backoffice-kyc-allowlist.controller.ts` POST `@Throttle` note; see also `todos/229`).
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts:52-54`.
- `src/common/guards/user-aware-throttler.guard.ts` — `getTracker` verifies with `jwtConfig.accessSecret` (user secret), admin tokens → IP fallback.

## Proposed Solutions
1. **Key on the verified admin `sub`** — the `BackofficeGuard` already sets `request.user`; extend/override the throttler tracker so backoffice routes bucket per-admin. Pros: real per-identity ceiling, fixes both NAT-DoS and enum-budget. Cons: touches shared guard logic; Effort: Medium. (Cross-cutting — likely supersedes the per-route fix and would also cover the POST.)
2. **Document the LB/XFF trust assumptions** — accept per-IP but explicitly record the proxy `trust proxy` / XFF config the key depends on, plus volume alerting as the real control. Pros: cheap, matches current stated posture. Cons: leaves the NAT-DoS + enum-budget gaps; Effort: Small.
3. **Raise/lower the limit knowingly** — orthogonal; only after choosing 1 or 2.

## Recommended Action
**RESOLVED — Solution 1 (per-admin keying), implemented in the global guard.** `UserAwareThrottlerGuard.getTracker`
now tries the **backoffice/admin secret** after the user secret: a valid admin token (`type==='admin'`) is
keyed `admin:<sub>` instead of falling back to IP. This fixes both gaps for **every** backoffice route (not
just this GET): admins behind a shared NAT/LB no longer share one bucket, and a leaked admin token is bounded
per-identity. Anonymous/invalid tokens still fall back to `ip:<addr>`.

**Nuance documented:** when `ADMIN_JWT_ACCESS_SECRET` is unset (dev), the backoffice secret falls back to
`JWT_ACCESS_SECRET`, so an admin token verifies under the *user* secret first and keys `user:<sub>` — still
per-identity, just a different prefix. When the secrets differ (prod), admin tokens key `admin:<sub>`. Either
way the ceiling is per-admin, not per-IP. Controller throttle comments (POST + GET) updated to match; the
stale `todo 229` per-IP framing is superseded.

## Technical Details
- `src/common/guards/user-aware-throttler.guard.ts` — inject `backofficeJwtConfig`; second verify → `admin:<sub>`.
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts` — POST + GET throttle comments.
- `test/unit/common/user-aware-throttler.guard.spec.ts` — 6th ctor arg + 2 admin-keying cases.

## Acceptance Criteria
- [x] Decision recorded: per-admin keying implemented (global guard).
- [x] Guard unit test proves an admin token keys `admin:<sub>` (not IP); non-admin-typed token → IP fallback.
- [x] Full unit suite (626) + kyc-allowlist e2e (19) green; guard DI validated by AppModule boot.

## Work Log
- 2026-08-18: created from PR #37 review (security-sentinel P2).
- 2026-08-18: RESOLVED — per-admin keying in UserAwareThrottlerGuard (backoffice-secret verify → `admin:<sub>`), global across backoffice routes; controller comments updated; guard spec extended. Build + unit(626) + e2e(19) green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
- Related: `todos/229` (KYC admin throttler IP-keyed, prior resolution-by-documentation)
