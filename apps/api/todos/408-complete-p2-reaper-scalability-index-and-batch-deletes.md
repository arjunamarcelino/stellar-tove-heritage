---
status: complete
priority: p2
issue_id: 408
tags: [code-review, tov-30, pr-53, performance, database]
dependencies: []
---
# Reaper degrades to a Seq Scan and issues ~1,400 serial storage deletes per run

## Resolution (2026-08-26)
- Split `findReapable` into TWO index-served queries: (a) stale-terminal/abandoned live rows (`status IN pending/failed/ready AND created_at < cutoff`, TypeORM auto-scopes `deleted_at IS NULL` → uses `IDX_profile_images_reap`); (b) soft-deleted rows (`deleted_at IS NOT NULL`), served by a NEW partial index `IDX_profile_images_reap_deleted (created_at) WHERE deleted_at IS NOT NULL` (migration `1716000000049`). Both keep the `NOT EXISTS (users.profile_image_id)` active-avatar guard. No more Seq-Scan OR branch.
- Added `deleteMany(paths)` to `IProfileStorageService` (+ Supabase impl chunked at 100/round-trip, + fake). The reaper now collects all paths and does ONE batch delete per bucket instead of ~7 serial deletes/row (~1,400 round-trips → 2 chunked calls at the 200-row cap), then hard-deletes the rows.
Migration applied to the test DB; build + lint + profile integration green.

## Problem Statement
The profile-image reaper degrades to a full Seq Scan and issues roughly 1,400 serial storage deletes per run, making each run slow and load-heavy at scale.

## Findings
1. **The reap query cannot use the partial index.** `findReapable` (`src/modules/users/profile/repositories/profile-image.repository.ts:78-90`) filters `WHERE (status IN ('pending','failed') AND created_at < :cutoff) OR pi.deleted_at IS NOT NULL`. This cannot use `IDX_profile_images_reap (status, created_at) WHERE deleted_at IS NULL` (migration `src/database/migrations/1716000000048-AddProfileFieldsAndImages.ts:49-52`) because the OR's second branch targets `deleted_at IS NOT NULL` — rows the partial index EXCLUDES. No index serves that branch → Seq Scan + Sort every 10 min.
2. **Deletes are serial, one path per call.** `ProfileImageReaperService.reap` (`src/modules/users/profile/maintenance/profile-image-reaper.service.ts:35-42`) awaits 7 SEPARATE `delete()` calls per row (3 public + 3 private + source), and `SupabaseStorageService.delete` (`src/modules/storage/supabase-storage.service.ts` delete method) does `remove([singlePath])` — up to 1,400 serial round-trips at the 200-row batch cap (~70s wall-clock).

## Proposed Solutions
### Option A — Two index-served queries + batched per-bucket deletes (Recommended)
Split `findReapable` into two index-served queries (stale-terminal via the existing partial index + soft-deleted via a NEW `CREATE INDEX … (created_at) WHERE deleted_at IS NOT NULL`) and UNION capped results; batch each row's paths into one `remove([...])` per bucket plus a bounded `Promise.all`.
- Effort: Medium · Risk: Low.

### Option B — Batch deletes + add the soft-deleted partial index only
Minimal: just batch the deletes (the biggest win) and add the soft-deleted partial index.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/repositories/profile-image.repository.ts`, `src/modules/users/profile/maintenance/profile-image-reaper.service.ts`, `src/modules/storage/supabase-storage.service.ts`, `src/database/migrations/1716000000048-AddProfileFieldsAndImages.ts`.

## Acceptance Criteria
- [ ] The reaper query is index-served on both branches.
- [ ] Storage deletes are batched per bucket.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
