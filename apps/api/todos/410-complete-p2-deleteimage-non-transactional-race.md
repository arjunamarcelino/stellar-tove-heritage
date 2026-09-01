---
status: complete
priority: p2
issue_id: 410
tags: [code-review, tov-30, pr-53, data-integrity, concurrency]
dependencies: []
---
# deleteImage is non-transactional; a concurrent activation can point the user at a deleted image

## Resolution (2026-08-26)
- `deleteImage` now calls the new `ProfileImageRepository.softDeleteAndClearAvatar(userId, imageId)`, which soft-deletes the image AND nulls `users.profile_image_id` (only if it was the active avatar) in ONE `runInTransaction` — no more separate soft-delete + FK-null. Blob purge stays best-effort after the commit.
- Closed the activation direction of the race: `updateProfile` now applies text/social fields (and a `profileImageId:null` clear) via `updateProfileFields`, but a NON-null activation goes through the new guarded `UserRepository.activateAvatar(userId, imageId)` — a conditional `UPDATE users … WHERE EXISTS (image still owned, ready, not soft-deleted)`. A concurrent delete → 0 rows → the service throws `PROFILE_IMAGE_NOT_READY` instead of pointing the FK at a deleted image.
Build + lint + profile unit (25) + integration (8) green.

## Problem Statement
`deleteImage` performs its soft-delete, FK-null, and blob purge as separate operations. A crash or a concurrent activation can leave `users.profile_image_id` pointing at a soft-deleted (then hard-deleted) image.

## Findings
`ProfileService.deleteImage` (`src/modules/users/profile/profile.service.ts:213-225`): `softDeleteOwned` (txn A) → `findProfileFieldsByUserId` + `updateProfileFields({profileImageId:null})` (txn B) → `unpublishImage`/`purgePrivate` (storage). The FK-null is NOT in the same txn as the soft-delete.

Concurrent `deleteImage(id)` vs `updateProfile` activation of the same id: if activation's `findOwned` (`:74`) reads the row before the soft-delete commits, it publishes and sets `profile_image_id=id` AFTER the delete → the user points at a soft-deleted image that the reaper later hard-deletes (avatar vanishes). The view self-hides (`src/modules/users/profile/profile-view.service.ts:50-51`) and the reaper SET NULL eventually heals, but there is a transient/again-lost window.

## Proposed Solutions
### Option A — Single transaction + activation re-assert (Recommended)
Wrap the soft-delete + `profile_image_id` clear in one `runInTransaction`; have activation re-assert `deleted_at IS NULL` ownership inside its write.
- Effort: Medium · Risk: Low.

### Option B — Guard the activation FK-set only
Add `WHERE deleted_at IS NULL` to the activation FK-set and accept the delete non-atomicity.
- Effort: Small · Risk: Medium.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/profile.service.ts`, `src/modules/users/profile/profile-view.service.ts`, `src/modules/users/profile/repositories/profile-image.repository.ts`.

## Acceptance Criteria
- [ ] After `deleteImage`, `users.profile_image_id` is never left pointing at the deleted row, even under a concurrent activation.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
