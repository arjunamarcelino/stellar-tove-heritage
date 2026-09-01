---
status: complete
priority: p3
issue_id: 184
tags: [code-review, performance, quality, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (projected read). Added `findPublicProfileByHandleCanonical(canonical)` to `IUserRepository`
+ `UserRepository` — same canonical lookup as `findByHandleCanonical` but `select`-projected to only the
public-profile fields (`id, handle, handleCanonical, handleHistoryPublic, createdAt`), so `passwordHash` /
`refreshTokenHash` are never hydrated for an anonymous request (mirrors the TOV-26 `findHandleByUserId`
precedent). `id` is included in the projection to avoid the all-NULL-projection null (PR #28 learning) and for
the history lookup. `CollectorsService.getProfile` now calls the projected method; renamed the mock in the
collectors unit spec. Build clean; collectors unit (9) + handle-history integration (10) + collectors e2e (9)
green (the e2e already asserts the response contains only `{handle, previousHandles, createdAt}`).

# Collectors public read hydrates the full User row (incl. secret columns)

## Problem Statement
`CollectorsService` uses `findByHandleCanonical`, which hydrates the full `User` row (including
`passwordHash`, `refreshTokenHash`) for a PUBLIC endpoint. TOV-26 introduced the projected
`findHandleByUserId` specifically to avoid hydrating secret columns for `GET /me/handle`; the collector
read reuses the un-projected method.

Secrets never leave the service (the DTO whitelists 3 fields, and the e2e asserts exactly
`['createdAt','handle','previousHandles']`), so there is no leak — this is a minor in-memory-hydration
concern only.

## Findings
- `src/modules/collectors/collectors.service.ts:33` — `findByHandleCanonical` (un-projected).
- Precedent: `src/modules/users/repositories/user.repository.ts` `findHandleByUserId` (projected).

## Proposed Solutions
### Option A: Add a projected repo read for the collector path
- **Pros:** no secret columns hydrated on a public path; mirrors TOV-26 precedent. **Cons:** another
  repo method. **Effort: Small.**
- Returns only `{ id, handle, handleCanonical, handleHistoryPublic, createdAt }`.

### Option B: Keep as-is and document
- **Pros:** simpler, no leak. **Cons:** hydrates secret columns in memory on a public path. **Effort: None.**

## Recommended Action
_(triage — Option B acceptable; Option A if hydrating secret columns on a public path is a concern.)_

## Technical Details
- Files: `collectors.service.ts`, `user.repository.ts` (+ interface) if projected.

## Acceptance Criteria
- [x] Projected read (`findPublicProfileByHandleCanonical`) used; secret columns (passwordHash/refreshTokenHash) are no longer hydrated on the public path.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (code-simplicity-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
