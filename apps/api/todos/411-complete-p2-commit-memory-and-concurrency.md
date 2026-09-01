---
status: complete
priority: p2
issue_id: 411
tags: [code-review, tov-30, pr-53, performance, security, dos]
dependencies: []
---
# Commit path downloads full source into memory before the size check and has no global concurrency cap

## Resolution (2026-08-26)
Decision (confirmed): size-check-before-download + a global commit concurrency cap.
- Added `objectSize(path)` to `IProfileStorageService` (Supabase impl reads metadata via `list(search)` — no bytes; + fake). `commitUpload` now checks the object size BEFORE downloading: `null` → 422 `PROFILE_UPLOAD_MISSING`, `> maxBytes` → 422 `PROFILE_IMAGE_TOO_LARGE` (mark failed). An oversized object is never streamed into memory, so memory safety no longer depends solely on the bucket `file_size_limit`.
- Added `ProfileCommitConcurrencyInterceptor` (singleton, shared counter, cap = `PROFILE_COMMIT_MAX_CONCURRENCY` default 8) on `POST /me/profile-image/commit` → fast 503 `PROFILE_COMMIT_BUSY` on overflow, bounding aggregate download + sharp-decode load on the libuv threadpool.
Build + lint + profile unit/integration/e2e green.

## Problem Statement
The commit path downloads the full source object into memory BEFORE the size check, runs sharp synchronously in the HTTP handler, and has no global concurrency cap. The only real size gate is an unenforced bucket `file_size_limit`.

## Findings
1. **Full download before the size check.** `commitUpload` (`src/modules/users/profile/profile.service.ts:169`) → `downloadSource` (`:228-234`) pulls the ENTIRE object into a Buffer (`src/modules/storage/supabase-storage.service.ts` download) and only then `probeUpload` compares `buffer.length > maxBytes` (`src/modules/users/profile/profile-image.probe.ts:23`). The signed upload URL doesn't constrain content-length; config concedes "the bucket's file_size_limit is the first gate" (`src/modules/users/profile/config/profile-image.config.ts:11`). If the source bucket has no `file_size_limit`, a client PUTs a multi-GB object then commits → OOM, repeatable per in-flight slot.
2. **Synchronous sharp probe with no global cap.** The probe runs `sharp().metadata()` (libuv threadpool) synchronously in the request with only a per-user 10/min throttle (`src/modules/users/profile/me-profile-image.controller.ts:48`) — no global cap like KYC's `KycConcurrencyInterceptor`. Wallet-only users are cheap to mint → an aggregate burst saturates the threadpool. `sharp.concurrency(1)` + `cache(false)` are set only in the WORKER (`src/modules/users/profile/derivatives/profile-derivative.service.ts:22-23`), not the API process.

## Proposed Solutions
### Option A — Range-probe + global concurrency cap + hard bucket gate (Recommended)
Fetch only a header byte-range (~64KB) for the probe instead of the whole object; add a global concurrency interceptor on commit; make the source bucket `file_size_limit` a hard pre-deploy gate.
- Effort: Medium · Risk: Low.

### Option B — Enforce bucket limit + global cap only
At minimum enforce/verify the bucket `file_size_limit` (checklist gate) and add the global concurrency cap.
- Effort: Small · Risk: Medium.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/profile.service.ts`, `src/modules/storage/supabase-storage.service.ts`, `src/modules/users/profile/profile-image.probe.ts`, `src/modules/users/profile/config/profile-image.config.ts`, `src/modules/users/profile/me-profile-image.controller.ts`, `src/modules/users/profile/derivatives/profile-derivative.service.ts`.

## Acceptance Criteria
- [ ] An oversized upload is rejected without downloading it fully into memory.
- [ ] Commit has a global concurrency bound.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
