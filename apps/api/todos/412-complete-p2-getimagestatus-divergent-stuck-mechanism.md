---
status: complete
priority: p2
issue_id: 412
tags: [code-review, tov-30, pr-53, quality, correctness]
dependencies: []
---
# `getImageStatus` divergent "stuck processing" mechanism contradicts the reconcile re-drive

## Resolution (2026-08-26)
Removed the display-only `processing → failed` derivation from `ProfileService.getImageStatus` (`profile.service.ts`); the poll now returns the real DB status. The reconcile job is the single authoritative terminator (re-drive at 10m, hard-fail at 60m) and the FE bounds its own poll with a client-side timeout per the FE contract — so the backend can no longer report `failed` for a row it is still re-driving. Dropped the now-unused `PROFILE_PROCESSING_STUCK_MINUTES` import from the service (it remains the reconcile re-drive threshold). Build + lint green.

## Problem Statement
Two independent "stuck processing" mechanisms with different thresholds and verdicts coexist. The status poll can tell a client its image `failed` while the backend is still actively re-driving that same row toward `ready`, producing a contradiction between what the client sees and what the backend actually does.

## Findings
- `ProfileService.getImageStatus` (`src/modules/users/profile/profile.service.ts:200-211`) reports `failed` — a **display-only** verdict that is never persisted — once a `processing` row's `updatedAt` is older than `PROFILE_PROCESSING_STUCK_MINUTES` (10m).
- `ProfileImageReconcileService.reconcile` (`src/modules/users/profile/maintenance/profile-image-reconcile.service.ts:33-51`) **re-drives** a stuck row at the 10m mark and only hard-fails it at `PROFILE_PROCESSING_FAIL_MINUTES` (60m).
- `updatedAt` is stamped only on the pending→processing transition; a re-drive does not re-stamp it. So between 10m and 60m a row is being actively re-driven and may still reach `ready`, yet the poll has already told the client `failed`.

## Proposed Solutions
### Option A — Remove the display-only derivation; let the poll reflect real DB state
Delete the display-only `failed` derivation (around `profile.service.ts:205-208`) so the poll returns the actual persisted status. The reconcile job becomes the single authoritative terminator of stuck rows.
- Effort: Small · Risk: Low.

### Option B — Collapse to one threshold owned by reconcile
If fast client-side termination is genuinely required, lower `PROFILE_PROCESSING_FAIL_MINUTES` and have reconcile own the single flip to `failed` (one threshold, one verdict, persisted). The poll then reads that persisted state.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/profile.service.ts:200-211`, `src/modules/users/profile/maintenance/profile-image-reconcile.service.ts:33-51`.
- Config: `PROFILE_PROCESSING_STUCK_MINUTES` (10m), `PROFILE_PROCESSING_FAIL_MINUTES` (60m).
- Root cause: `updatedAt` is stamped only on pending→processing, so re-drive activity is invisible to the poll's age check.

## Acceptance Criteria
- [ ] The status poll never returns `failed` for a row the reconcile is still re-driving.
- [ ] There is a single authoritative threshold/verdict for terminating stuck `processing` rows.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
