---
status: complete
priority: p2
issue_id: 407
tags: [code-review, tov-30, pr-53, retention, storage, data-integrity]
dependencies: []
---
# Superseded avatar images and private blobs are never reclaimed (unbounded growth)

## Resolution (2026-08-26)
Decision (confirmed): purge the prior image on replace/remove — no "re-activate an old upload" feature.
- Added `ProfileService.retireImage(userId, imageId)` = soft-delete the row + purge its public and private blobs. `updateProfile` now calls `retireImage` (was `unpublishImage`) for the superseded prior image on any avatar change or removal, so superseded images and their private source+derivatives are reclaimed immediately (not kept).
- Extended `findReapable` to also reap unreferenced `ready` rows past the grace window (abandoned / never-activated uploads); the `NOT EXISTS (users.profile_image_id)` belt (todo 409) keeps the active avatar safe.
- Refactored `purgePrivate` to take `(userId, imageId)` (deterministic paths) so it works without the entity.
Integration test asserts the prior image's private source is purged and its row soft-deleted after replacement. Build + lint + profile integration green.

## Problem Statement
Superseded/abandoned avatar images and their PRIVATE blobs are never reclaimed, leading to unbounded per-user DB row growth and unbounded storage growth. Three independent reviewers (security, data-integrity, performance) concurred on this finding.

## Findings
1. **Replacement only unpublishes the public copy.** On avatar replacement, `ProfileService.updateProfile` (`src/modules/users/profile/profile.service.ts:82-88`) calls only `unpublishImage(priorImageId)` (`:247-251`), which deletes ONLY the public copies. The prior `profile_images` row stays `status='ready'`, and its private source + private derivatives are retained forever.
2. **The reaper never age-reaps `ready` rows.** `findReapable` (`src/modules/users/profile/repositories/profile-image.repository.ts:78-90`) only reclaims `(pending|failed AND created_at < cutoff) OR deleted_at IS NOT NULL`. `ready` rows are NEVER age-reaped.
3. **The in-flight cap does not bound `ready` rows.** `countNonTerminalByUser` (`profile-image.repository.ts:37-39`) counts only pending/processing, so `PROFILE_MAX_INFLIGHT_IMAGES=5` (`src/modules/users/profile/constants/profile-image.constants.ts:69`) never bounds `ready` rows.

A user who loops requestUpload → commit (or re-activates avatars) accumulates unbounded `ready` rows plus their blobs. This also feeds the reaper Seq-Scan cost (see todo 408).

## Proposed Solutions
### Option A — Soft-delete the prior active image on activation (Recommended)
On activation, soft-delete the previously-active image and enqueue a purge of its private blobs, so the reaper's `deleted_at IS NOT NULL` branch reclaims it.
- Effort: Medium · Risk: Low.

### Option B — Per-user total cap + reap unreferenced `ready` rows
Add a per-user cap on TOTAL non-deleted images (LRU evict) and extend `findReapable` to reap unreferenced `ready` rows past a grace window.
- Effort: Medium · Risk: Medium.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/profile.service.ts`, `src/modules/users/profile/repositories/profile-image.repository.ts`, `src/modules/users/profile/constants/profile-image.constants.ts`.

## Acceptance Criteria
- [ ] Replacing an avatar N times leaves no orphaned prior `ready` rows or private blobs after the grace window.
- [ ] A per-user image cap exists.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
