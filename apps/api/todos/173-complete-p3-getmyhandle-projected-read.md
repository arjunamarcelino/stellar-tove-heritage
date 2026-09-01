---
status: complete
priority: p3
issue_id: 173
tags: [code-review, performance, security, handle, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Added `findHandleByUserId(userId): Promise<{ handle: string | null } | null>` to
`IUserRepository` + `UserRepository` (projected `findOne` with `select: { id: true, handle: true }`), and
`HandleService.getMyHandle` now calls it instead of `findOneById` — so `passwordHash`/`refreshTokenHash`
never load for a `GET /me/handle`. Also removed the now-unused `findOneById` re-declaration from
`IUserRepository`, keeping the token interface minimal (HandleService was its only bare consumer).

**Gotcha caught by the e2e read-back test:** a handle-only projection (`select: { handle: true }`) makes
TypeORM return `null` for a row whose `handle` is NULL (it can't tell an all-NULL projection from "no
row"), which 404'd a handle-less user. Fixed by also selecting `id`. Build clean; handle e2e green (16),
including AC6 null-before/value-after.

# `getMyHandle` loads the full `User` row (incl. secret columns) to return only `handle`

## Problem Statement
`HandleService.getMyHandle()` calls `findOneById(userId)`, which SELECTs every column of `users`
(email, `passwordHash`, `refreshTokenHash`, names, …) to return just `{ handle }`. It's a PK lookup
(fast, O(log n)), so the per-request cost is negligible — this is a minor hygiene item, not a bottleneck.
The mild concern is that secret columns are pulled into application memory for a read that only needs one
public field. The DTO correctly returns only `handle`, so nothing leaks to the client.

## Findings
- `src/modules/users/handle/handle.service.ts:57` — `const user = await this.users.findOneById(userId)`.
- `findOneById` returns the full entity; `passwordHash`/`refreshTokenHash` never leave the service.

## Proposed Solutions
### Option A: Add a projected repo read
- `findHandleByUserId(userId): Promise<{ handle: string | null } | null>` selecting only `handle`
  (and `id`), used by `getMyHandle`.
- **Pros:** avoids loading secrets into memory; tiny query. **Cons:** one more repo method for a marginal
  gain. **Effort: Small.**

### Option B: Leave as-is
- **Pros:** no change; PK lookup is already cheap and secrets don't leave the service. **Cons:** loads more
  columns than needed. **Effort: None.**

## Recommended Action
_(triage — optional hygiene; only worth it if you prefer not to hydrate secret columns for a public read.)_

## Technical Details
- Files: `src/modules/users/repositories/user.repository.ts` + interface (new projected method);
  `src/modules/users/handle/handle.service.ts` (use it).

## Acceptance Criteria
- [ ] Decision recorded; if pursued, `getMyHandle` reads only the `handle` column.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (performance-oracle). Micro-inefficiency; no client
  leak (DTO returns only `handle`).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
