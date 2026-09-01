---
status: complete
priority: p2
issue_id: 409
tags: [code-review, tov-30, pr-53, data-integrity, concurrency]
dependencies: []
---
# Unguarded status transitions can clobber an active avatar under a stale-read race

## Resolution (2026-08-26)
Guarded both transitions in `ProfileImageRepository` and added a not-referenced belt to the reaper:
- `markReady` now updates only a live `processing` row (`WHERE id AND status='processing' AND deleted_at IS NULL`); `markFailed` only a live `pending`/`processing` row (`status IN ('pending','processing')`). A losing concurrent commit/worker can no longer clobber an already-`ready`/activated avatar to `failed`.
- `findReapable` now excludes any row referenced by `users.profile_image_id` (`AND NOT EXISTS (SELECT 1 FROM users u WHERE u.profile_image_id = pi.id)`), so an active avatar is never a reap candidate even if it somehow reached a reapable state.
Added an integration test asserting a referenced row is never reaped. Build + lint + profile unit/integration green.

## Problem Statement
`markFailed`/`markReady` are unconditional updates and the reaper has no "still-referenced" guard, so under a stale-read race an active avatar could be clobbered to `failed` and then hard-deleted (FK SET NULL wipes the user's avatar). This is hard to trigger in practice — deterministic probes plus `upsert:false` narrow the window — but the guards are cheap and correct.

## Findings
1. **Unconditional status updates off a possibly-stale read.** `markFailed` (`src/modules/users/profile/repositories/profile-image.repository.ts:61-63`) and `markReady` (`:57-59`) do unconditional `update({id}, {status})` with no status precondition. The two `markFailed` calls in `commitUpload` (`src/modules/users/profile/profile.service.ts:172,176`) run off a possibly-stale `status==='pending'` read (`:165`).
2. **The reaper has no not-referenced guard.** `findReapable` reaps any old `failed` row with no check that it isn't referenced by `users.profile_image_id`; `hardDelete` (`profile-image.repository.ts:92-94`) then fires `FK_users_profile_image ON DELETE SET NULL` (migration `src/database/migrations/1716000000048-AddProfileFieldsAndImages.ts:67-71`).

## Proposed Solutions
### Option A — Add status preconditions + reaper not-referenced guard (Recommended)
Guard `markFailed` with `WHERE status IN ('pending','processing') AND deleted_at IS NULL` and `markReady` with `WHERE status='processing'`; add a not-referenced guard to the reap path (`NOT EXISTS (SELECT 1 FROM users u WHERE u.profile_image_id = pi.id)`).
- Effort: Small · Risk: Low.

### Option B — Reaper guard only
Rely on `upsert:false` + deterministic probes and only add the reaper not-referenced guard.
- Effort: Small · Risk: Medium.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/repositories/profile-image.repository.ts`, `src/modules/users/profile/profile.service.ts`, `src/database/migrations/1716000000048-AddProfileFieldsAndImages.ts`.

## Acceptance Criteria
- [ ] A `ready`/activated row can never be flipped to `failed` by a losing concurrent commit.
- [ ] The reaper never deletes a row referenced as an active avatar.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
