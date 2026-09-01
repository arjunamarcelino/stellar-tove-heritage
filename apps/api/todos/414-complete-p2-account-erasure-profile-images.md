---
status: complete
priority: p2
issue_id: 414
tags: [code-review, tov-30, pr-53, security, privacy, gdpr]
dependencies: []
---
# Account erasure does not purge profile images or the public avatar

## Resolution (2026-08-26)
Decision (confirmed): hook the existing admin user-delete path now.
- New neutral `ProfileErasureService.purgeForUser(userId)` — unpublishes every public avatar copy (batched) and soft-deletes all the user's `profile_images` rows; the reaper's soft-deleted branch then reclaims the private blobs. Exposed via `ProfileErasureModule`.
- `BackofficeUsersController.delete` now calls `usersService.softDelete` then `profileErasure.purgeForUser` (placed at the backoffice admin surface so the neutral UsersModule stays free of profile/storage deps). Added repo `findAllForUser`/`softDeleteAllForUser`.
- Tightened the reaper's active-avatar guard to `NOT EXISTS (... u.profile_image_id = pi.id AND u.deleted_at IS NULL)` so a soft-deleted user's dangling FK no longer protects its image rows from reaping.
Integration test asserts a deleted user's public copies are unpublished, rows soft-deleted, and the private source is reaped. Build + lint + profile integration (9) green.

## Problem Statement
Soft-deleting a user does not purge their profile images or their public avatar. The collector's avatar stays publicly fetchable indefinitely, which is a right-to-erasure (GDPR) gap. This is cross-cutting: no user-deletion flow exists yet, so there is currently nowhere that cascades a user deletion onto downstream personal data.

## Findings
- User `softDelete()` nullifies only `refreshTokenHash` (per `users/CLAUDE.md`); it does not touch `profile_images` or the public `tove-public` derivatives.
- `ProfileService` only purges public copies via the explicit `DELETE /me/profile-image/:id` path (`src/modules/users/profile/profile.service.ts:213-225`).
- The reaper's `deleted_at IS NOT NULL` branch would reclaim PRIVATE blobs if the image rows were soft-deleted — but nothing cascades a user soft-delete onto its image rows, and PUBLIC copies additionally need an explicit unpublish.
- Aligns with the existing TOV-29 erasure note (`kyc_reason`/`whitelisted_at` also not erased today).

## Proposed Solutions
### Option A — Cascade erasure onto profile images on user soft-delete
On user soft-delete, unpublish + purge the active avatar's public copies and mark the user's profile images reapable (soft-delete the rows) so the reaper reclaims the private blobs.
- Effort: Medium · Risk: Low.

### Option B — File as a consolidated erasure-flow follow-up
Track this as an explicit erasure-flow ticket covering profile images together with the KYC compliance columns (`kyc_reason`/`whitelisted_at`) so all right-to-erasure gaps are closed in one coherent flow.
- Effort: Medium · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: user `softDelete()` (see `users/CLAUDE.md`), `src/modules/users/profile/profile.service.ts:213-225`, reaper `deleted_at IS NOT NULL` branch.
- Public bucket: `tove-public` derivatives require explicit unpublish; private blobs are reaper-reclaimable once rows are soft-deleted.
- Related: TOV-29 erasure note (`kyc_reason`/`whitelisted_at`).

## Acceptance Criteria
- [ ] After a user is (soft-)deleted, their public avatar URLs return 404.
- [ ] After a user is (soft-)deleted, their profile-image blobs are reaped.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
