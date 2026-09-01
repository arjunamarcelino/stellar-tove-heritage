---
status: complete
priority: p2
issue_id: 202
tags: [code-review, testing, flake, kyc, TOV-29, PR-31]
dependencies: []
---

# E2E `registerWithId` derives the user id via `ORDER BY created_at DESC LIMIT 1` — latent flake

## Problem Statement
The new e2e helper fetches "the user I just registered" with
`SELECT id FROM users ORDER BY created_at DESC LIMIT 1`. This is correct **only** because `beforeEach`
truncates and each current test registers exactly one user. It is fragile: (1) `created_at` is a
timestamp — two users registered in one test (or coarse timestamp resolution) makes `DESC LIMIT 1` pick
an arbitrary tie; (2) it silently couples the helper to the "one user per test" invariant, enforced only
by a comment. The register call already yields the identity — the robust source is the JWT `sub`, not a
timestamp-ordered DB re-query.

## Findings
- `test/e2e/kyc.e2e-spec.ts:202-208` — `registerWithId()` uses `ORDER BY created_at DESC LIMIT 1`. (test-quality P2.)
- `registerToken()` already returns the access token whose payload carries `sub` (the user id).

## Proposed Solutions
### Option A (recommended): decode the JWT `sub`
Derive `userId` from the access token payload (base64-decode the middle segment, read `sub`) instead of
the DB query. Robust regardless of how many users exist and independent of `created_at` ordering.
**Effort: Small.**

### Option B: return the id from the register response
If `POST /auth/register` returns the user id in its body, thread it through `registerToken` and return
`{ token, userId }` directly. **Effort: Small** (depends on the register response shape).

## Recommended Action
**RESOLVED (Option A — JWT `sub`).** `registerWithId` now decodes the access token's middle segment
(`base64url` → JSON) and returns its `sub` (the user id `@CurrentUser('sub')` resolves to), instead of
`SELECT id FROM users ORDER BY created_at DESC LIMIT 1`. Robust regardless of how many users a test registers,
and no longer coupled to the truncate/one-user-per-test invariant.

## Technical Details
- Affected: `test/e2e/kyc.e2e-spec.ts:201-208` (helper) and the tests that call `registerWithId` (whitelisted/frozen/soft-deleted/is_active cases).

## Acceptance Criteria
- [ ] `registerWithId` (or its replacement) resolves the caller's id without a `created_at`-ordered query, so it stays correct if a test registers multiple users.

## Work Log
- 2026-07-17: Filed from PR #31 review (test-quality P2). No code changed.
- 2026-07-17: RESOLVED. registerWithId derives id from the JWT sub. lint/e2e(131) green. Status → complete.
