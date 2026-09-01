---
status: complete
priority: p2
issue_id: 413
tags: [code-review, tov-30, pr-53, architecture, coupling]
dependencies: []
---
# AuthModule boots two service-role Supabase clients just to build a public URL string

## Resolution (2026-08-26)
Introduced a lightweight `ProfilePublicUrlService` (token `PROFILE_PUBLIC_URL`) that builds the public avatar URL by pure string concatenation (the same shape Supabase `getPublicUrl` returns) with NO `createClient`. `ProfileViewService` now injects `PROFILE_PUBLIC_URL` instead of `PROFILE_PUBLIC_STORAGE`, and `ProfileViewModule` imports the new `ProfilePublicUrlModule` instead of `ProfileStorageModule`. AuthModule (→ ProfileViewModule) no longer constructs two service-role Supabase storage clients at boot. Reverted the `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`PROFILE_IMAGE_SOURCE_BUCKET` env additions from `vitest.config.integration.ts` — the passkey integration boots the real AuthModule without them now. `ProfileService` keeps `PROFILE_PUBLIC_STORAGE` for the activation copy/unpublish (it genuinely needs the client). Build + lint + auth/profile integration (58) + profile e2e (4) green.

## Problem Statement
AuthModule now transitively constructs two service-role Supabase storage clients at boot, solely to produce a deterministic public URL string. One of the two clients (the private source client) is never used on this path at all. This drags a heavyweight dependency into AuthModule's boot graph and forces Supabase env into test configs that otherwise wouldn't need it.

## Findings
- `auth.module.ts` imports `ProfileViewModule` (`src/modules/auth/auth.module.ts:~28`).
- `ProfileViewModule` imports `ProfileStorageModule` (`src/modules/users/profile/profile-view.module.ts:15`).
- `ProfileStorageModule` eagerly `new SupabaseStorageService(...)` × 2 (private + public) at boot (`src/modules/users/profile/storage/profile-storage.module.ts:16-33`), each calling `createClient(...)`.
- But `ProfileViewService` (`src/modules/users/profile/profile-view.service.ts:31`) injects ONLY `PROFILE_PUBLIC_STORAGE` and calls only `getPublicUrl(path)` (`profile-view.service.ts:52`), which is a pure string build (`src/modules/storage/supabase-storage.service.ts:80-83`).
- This coupling forced `SUPABASE_URL` + `PROFILE_IMAGE_SOURCE_BUCKET` into the integration test config (`test/integration/setup.ts`, `vitest.config.integration.ts`).
- `src/config/profile-image.config.ts:5` explicitly states a DIP stance, yet the current design drags a heavyweight client (×2, including the unused source client) into AuthModule's boot graph.

## Proposed Solutions
### Option A — Introduce a narrow public-URL port
Add an `IPublicUrlBuilder` port (or build the URL directly in `ProfileViewService` from `supabaseConfig.url` + `profileImageConfig.publicBucket`), removing all Supabase storage-client construction from AuthModule's transitive graph.
- Effort: Medium · Risk: Low.

### Option B — Accept as-is
Leave the coupling in place (it works in prod where Supabase config is always present) and accept the test-env coupling as the cost.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/auth/auth.module.ts:~28`, `src/modules/users/profile/profile-view.module.ts:15`, `src/modules/users/profile/storage/profile-storage.module.ts:16-33`, `src/modules/users/profile/profile-view.service.ts:31,52`, `src/modules/storage/supabase-storage.service.ts:80-83`, `src/config/profile-image.config.ts:5`.
- Test coupling: `test/integration/setup.ts`, `vitest.config.integration.ts`.

## Acceptance Criteria
- [ ] AuthModule boots without constructing Supabase storage clients.
- [ ] The auth/integration test env no longer needs `SUPABASE_URL`/source-bucket solely for the profile view.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
