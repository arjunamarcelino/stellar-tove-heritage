---
status: complete
priority: p2
issue_id: 178
tags: [code-review, quality, type-safety, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Narrowed `currentCanonical` at the top of `buildPreviousHandles`: `const currentCanonical = user.handleCanonical;
if (!currentCanonical) return [];`. This makes the current-handle exclusion (`row.handleCanonical ===
currentCanonical`) type-GUARANTEED (string === string) rather than safe-by-coincidence — if the canonical were
ever null the exclusion couldn't fire and the current handle would leak into `previousHandles`; now it fails
safe to `[]` (and skips the history read). Added a unit test asserting a null-canonical user yields `[]` and
never calls `listByUserId`. Build clean; collectors unit (9) green.

# buildPreviousHandles current-handle exclusion is safe-by-coincidence, not by construction

## Problem Statement
In `CollectorsService.buildPreviousHandles`, `currentCanonical = user.handleCanonical` is typed
`string | null` (User.handleCanonical is nullable), but the exclusion `row.handleCanonical === currentCanonical`
relies on it being non-null; if it were null, the current handle could leak into `previousHandles`. It's
safe today only because `getProfile` guards `if (!user?.handle)` (on `handle`, not `handleCanonical`) and
the DB couples the two — but the type system doesn't know that.

## Findings
- `src/modules/collectors/collectors.service.ts:38` — guard is on `handle`.
- `src/modules/collectors/collectors.service.ts:52` — exclusion compares `handleCanonical`.
- `src/modules/users/entities/user.entity.ts:37` (`string | null`) vs `handle-history.entity.ts:27` (`string`).

## Proposed Solutions
### Option A: Narrow explicitly
- **Pros:** `const currentCanonical = user.handleCanonical; if (!currentCanonical) throw failHttp(COLLECTOR_NOT_FOUND, 404, …)` makes the exclusion invariant type-guaranteed. **Cons:** an extra guard branch. **Effort: Small.**

### Option B: Guard on `handleCanonical`
- **Pros:** guard on `handleCanonical` (not just `handle`) at the not-found check; single guard covers both. **Cons:** exclusion still relies on the narrowing being co-located. **Effort: Small.**

## Recommended Action
_(triage — Option A.)_

## Technical Details
- Files: `src/modules/collectors/collectors.service.ts` (+ unit test).

## Acceptance Criteria
- [x] Exclusion is type-safe; a null-canonical user cannot leak the current handle (fails safe to []); unit test covers.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (kieran-typescript-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
