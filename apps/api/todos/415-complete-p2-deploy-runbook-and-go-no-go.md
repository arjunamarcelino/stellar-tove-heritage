---
status: complete
priority: p2
issue_id: 415
tags: [code-review, tov-30, pr-53, deployment, ops, documentation]
dependencies: []
---
# No deploy runbook; ops prerequisites enforced nowhere in code

## Resolution (2026-08-26)
Wrote the committed deploy runbook `docs/solutions/deployment-issues/2026-08-26-tov30-profile-image-deploy-runbook.md` with the full Go/No-Go checklist: new env table (incl. the required `PROFILE_IMAGE_SOURCE_BUCKET` fail-fast), pre-deploy BLOCKERS (private source bucket + `file_size_limit`, source≠public, deny-LIST on tove-public, sharp binary load), migration/deploy steps, post-deploy verification SQL (columns/constraints/indexes + lifecycle health), the oversized-upload memory check, and the rollback plan (leave 048/049 applied; never force-revert). Note: #411 already added the code-side `objectSize` gate so the bucket `file_size_limit` is now defense-in-depth rather than the sole memory gate.

## Problem Statement
The PR ships no deploy runbook, and its operational prerequisites (source-bucket `file_size_limit`, a private source bucket, deny-LIST on the public bucket) are enforced NOWHERE in code — only described in the PR body. Every comparable prior ticket (TOV-160/172/174/175/189/191) shipped a `docs/solutions/deployment-issues/*-deploy-runbook.md`. This one does not.

## Findings
- New REQUIRED env `PROFILE_IMAGE_SOURCE_BUCKET` (Joi `.required()`, `src/config/validation-schema.ts` + `src/config/profile-image.config.ts`) crash-loops the WHOLE service if unset.
- Source-bucket `file_size_limit` is load-bearing for memory safety (see todo 411) but is unenforced in code (`src/config/profile-image.config.ts:11`).
- `ProfileStorageModule` never asserts source≠public or that the source bucket is private (`src/modules/users/profile/storage/profile-storage.module.ts:16-33`).
- Maintenance jobs default ON, and the reaper hard-deletes ~10 min after boot.
- `sharp` is a native dependency — the built image must load the correct linuxmusl binary.

### Go/No-Go checklist to embed in the runbook
- **PRE-DEPLOY:** set `PROFILE_IMAGE_SOURCE_BUCKET`; create the source bucket PRIVATE with `file_size_limit` ≤ `PROFILE_IMAGE_MAX_BYTES` + `allowed_mime_types` jpeg/png/webp; verify source≠public; create `tove-public` as public-READ but deny anon LIST; `docker run … node -e "require('sharp')"`.
- **DEPLOY:** `yarn migration:run`; verify boot + 2 repeatable jobs registered.
- **POST-DEPLOY SQL:** confirm columns landed; `profile_images` table + constraints + `IDX_profile_images_user`/`IDX_profile_images_reap` present; `SELECT status, count(*) FROM profile_images GROUP BY status`; `SELECT count(*) FROM profile_images WHERE status='processing' AND updated_at < now() - interval '60 minutes'` expect 0; run an oversized-upload memory check.
- **ROLLBACK:** redeploy the prior image, LEAVE migration 048 applied — its `down()` is fail-closed; do NOT force-revert in prod.

## Proposed Solutions
### Option A — Write the runbook
Author `docs/solutions/deployment-issues/2026-08-26-tov30-profile-image-deploy-runbook.md` containing the Go/No-Go checklist above.
- Effort: Small · Risk: Low.

### Option B — Runbook plus code-level guards
Add the runbook AND code-level guards: assert source≠public at module init and emit a startup warning if buckets look public/mis-scoped.
- Effort: Medium · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/config/validation-schema.ts`, `src/config/profile-image.config.ts:11`, `src/modules/users/profile/storage/profile-storage.module.ts:16-33`, migration 048, maintenance/reaper jobs.
- Native dep: `sharp` (verify linuxmusl binary in the built image).
- Precedent: TOV-160/172/174/175/189/191 all shipped a `docs/solutions/deployment-issues/*-deploy-runbook.md`.

## Acceptance Criteria
- [ ] A committed runbook exists at `docs/solutions/deployment-issues/2026-08-26-tov30-profile-image-deploy-runbook.md`.
- [ ] The required env + bucket prerequisites (source private, file_size_limit, source≠public, public deny-LIST) are checklisted.
- [ ] PRE-DEPLOY / DEPLOY / POST-DEPLOY SQL / ROLLBACK steps are all captured.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
