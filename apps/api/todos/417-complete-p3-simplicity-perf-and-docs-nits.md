---
status: complete
priority: p3
issue_id: 417
tags: [code-review, tov-30, pr-53, simplicity, performance, architecture, docs]
dependencies: []
---
# Simplicity, perf & docs nits (dead exports, over-export, duplicated sharp opts, redaction inference, perf polish, new-convention docs)

## Resolution (2026-08-26)
1. Deleted dead exports `PROFILE_FORMAT_TO_MIME` and `PROFILE_MAX_DERIVE_ATTEMPTS` (0 references).
2. Dropped the `export` on `PROFILE_IMAGE_ALLOWED_FORMATS` (internal only — derives the type + Set).
3. Extracted a shared `PROFILE_SHARP_INPUT_OPTS` used by BOTH the commit probe and the derivative worker so the sharp hardening can't drift.
4. Declined (conscious): the `redactKeys` public-bucket over-redaction — harmless over-redaction; not worth threading a flag through the shared SupabaseStorageService constructor.
5. Perf: `publishActive` now parallelizes the 3 download→upload copies (Promise.all). Declined: header range-read (#411 objectSize already prevents the oversized DoS) and projecting findOwned (single-user /me, not N+1).
6. Documented the raw-body PATCH validation (src/modules/CLAUDE.md) + failValidation errors[] shape (src/common/CLAUDE.md).
Build + lint + profile unit (26) + integration (9) green.

## Problem Statement
A cluster of low-value simplicity/perf/docs cleanups surfaced across the PR #53 (TOV-30) profile-fields review. None affect correctness. Several are cheap deletions/consolidations; the perf items are low-urgency polish; and two NEW sanctioned conventions this PR introduces should be recorded so a future reviewer doesn't "fix" them back.

## Findings
1. **Dead exports in profile-image constants.** `src/modules/users/profile/constants/profile-image.constants.ts` — `PROFILE_FORMAT_TO_MIME` (~lines 30-34) has ZERO references; `PROFILE_MAX_DERIVE_ATTEMPTS` (~line 57) has zero references (the retry count lives inline as `attempts: 5` in `PROFILE_DERIVE_JOB_OPTS`). Delete both, or wire them in (e.g. reference `PROFILE_MAX_DERIVE_ATTEMPTS` from the job opts).
2. **Over-export of `PROFILE_IMAGE_ALLOWED_FORMATS`.** `src/modules/users/profile/constants/profile-image.constants.ts:~27-29` — the array is only used internally (to derive the format type + `PROFILE_IMAGE_FORMAT_SET`). Drop the `export` on the array; the Set + type are the external API.
3. **Duplicated sharp-hardening options.** `src/modules/users/profile/profile-image.probe.ts:30-34` and `src/modules/users/profile/derivatives/profile-derivative.service.ts:55-59` both hand-set `failOn` / `limitInputPixels` / `animated`. Extract a shared `PROFILE_SHARP_INPUT_OPTS` const so the two decoders can't drift.
4. **Redaction force-enabled for the PUBLIC bucket.** `src/modules/storage/supabase-storage.service.ts:45` sets `redactKeys = bucketOverride !== undefined`; the profile factory passes a bucket positionally (`src/modules/storage/profile-storage.module.ts:22,30`), so redaction turns on. But public keys are `profile/{imageId}/{size}.webp` (no userId), so redaction is unnecessary and only reduces log debuggability — over-redaction (never under). Consider an explicit `redactKeys` flag instead of inferring sensitivity from `bucketOverride !== undefined`.
5. **Perf polish (low urgency).** (a) Double full-download of the source — commit-path probe at `src/modules/users/profile/profile.service.ts:169` plus worker at `src/modules/users/profile/derivatives/profile-derivative.service.ts:50`; the request-path probe could fetch only a header byte-range. (b) `publishActive` (`profile.service.ts:237-244`) does 6 sequential download→upload round-trips — `Promise.all` the 3 pairs. (c) `GET /me` `ProfileViewService` (`src/modules/users/profile/profile-view.service.ts:41,50-51`) runs a 2nd query hydrating the FULL `ProfileImage` entity when only `status` is needed — project to `{ status }`; latent N+1 if ever reused in a list.
6. **Document two NEW sanctioned conventions.** Record in `src/modules/CLAUDE.md` so a future reviewer doesn't revert them: (a) raw-body validation (`@Req()` + service-side `validateAndBuildPatch`, DTO for Swagger only) on `PATCH /me`, instead of `@Body()` + `ValidationPipe`; (b) the `failValidation` + `errors[]` 422 response shape (`src/common/http/fail-http.ts`).

## Proposed Solutions
### Option A — Apply the cheap cleanups + docs now, schedule perf polish (Recommended)
Apply 1-4 (delete dead exports, drop the over-export, extract the shared sharp opts, make redaction an explicit flag) and 6 (docs). Schedule 5 as perf polish (each item independent).
- Effort: Small–Medium · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/constants/profile-image.constants.ts`, `src/modules/users/profile/profile-image.probe.ts`, `src/modules/users/profile/derivatives/profile-derivative.service.ts`, `src/modules/storage/supabase-storage.service.ts`, `src/modules/storage/profile-storage.module.ts`, `src/modules/users/profile/profile.service.ts`, `src/modules/users/profile/profile-view.service.ts`, `src/modules/CLAUDE.md`, `src/common/http/fail-http.ts`.

## Acceptance Criteria
- [ ] Each nit is either applied or consciously declined with a reason.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
