---
status: complete
priority: p2
issue_id: 080
tags: [code-review, security, infrastructure, tov-19]
dependencies: []
---

# `trust proxy` Not Configured — Anonymous Throttle Keys on the Proxy IP

## Problem Statement
The new anonymous browse endpoints are rate-limited by the global `ThrottlerGuard`, which keys on
the client IP. No `trust proxy` is configured in `main.ts`, so behind a load balancer/reverse proxy
every request appears to come from the proxy IP: (a) all anonymous traffic shares one throttle
bucket, so a single abuser can rate-limit every visitor (a DoS on legitimate users), and (b) if
`trust proxy: true` is later set naively, `X-Forwarded-For` becomes attacker-controlled and the limit
is trivially bypassed. This is app-wide but is first exercised meaningfully by TOV-19's anonymous
surface. Documented as a follow-up in the plan; tracking it here so it isn't lost.

## Findings
- `src/main.ts` — no `app.set('trust proxy', …)`; two Swagger docs are built but proxy trust is never set.
- Global throttle is a single default tier (`src/config/throttle.config.ts`); `ThrottlerGuard` runs before `AuthGuard` and does not honor `@Public()`.

## Proposed Solutions

### Option A: Set a specific hop count
- **Description:** `app.set('trust proxy', <N>)` where N = the real number of proxy hops in front of
  the app (NOT `true`). Verify `ThrottlerGuard.getTracker` then resolves the true client IP.
- **Pros:** Correct per-client throttling; `X-Forwarded-For` can't be spoofed past the trusted hops.
- **Cons:** Deployment-specific value; must match infra.
- **Effort:** Small
- **Risk:** Low (medium if the hop count is wrong — set deliberately)

### Option B: Dedicated permissive browse tier (with A)
- **Description:** In addition to A, give public browse routes a dedicated throttle tier (owned by TOV-189).
- **Pros:** Tunes anonymous-read limits independently.
- **Cons:** More config; deferred scope.
- **Effort:** Small-Medium
- **Risk:** Low

## Recommended Action
Option A — env-configurable `TRUST_PROXY_HOPS` (default 1), user-confirmed.

## Implemented Solution
Applied **Option A**:
- `app.config.ts` — new `trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10)`.
- `validation-schema.ts` — `TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1)`.
- `main.ts` — `app.getHttpAdapter().getInstance()` cast to the Express `Application` and
  `.set('trust proxy', appCfg.trustProxyHops)` (a fixed hop count, never `true`). Kept the default
  app type so the existing loosely-typed docs/json handler stays untouched.
- `.env.example` — documented `TRUST_PROXY_HOPS=1` (1 = one LB hop; 0 = no proxy).

Each environment sets the real hop count; the default of 1 fits a single load balancer.

## Technical Details
- Changed: `src/config/app.config.ts`, `src/config/validation-schema.ts`, `src/main.ts`, `.env.example`.

## Acceptance Criteria
- [x] `trust proxy` is set to a configurable hop count so throttling uses the real client IP.
- [x] Value is a fixed number (never `true`), so `X-Forwarded-For` can't be spoofed past the trusted hops.
- [x] App boots with the setting; build + lint + unit 198 + e2e 45 green.

## Work Log
- 2026-07-01: Filed from PR #19 review (documented follow-up in the plan). App-wide infra concern surfaced by the anonymous surface.
- 2026-07-01: Resolved via Option A — env-configurable TRUST_PROXY_HOPS (default 1); `app.set('trust proxy', hops)`. Verified boot (TRUST_PROXY_HOPS=2) + build + lint + unit + e2e.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/19 · dedicated tier: TOV-189.
