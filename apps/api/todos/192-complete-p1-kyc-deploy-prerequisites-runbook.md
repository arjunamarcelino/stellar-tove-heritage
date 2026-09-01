---
status: complete
priority: p1
issue_id: 192
tags: [code-review, deployment, security, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17)
Delivered the code-hardening + the durable ops artifact; the actual provisioning is a deploy-time Go/No-Go
handed off in the runbook (can't be executed from the repo).

1. **Code hardening (Option B, the code-fixable part):** made `KYC_STORAGE_BUCKET` **required** (dropped the
   `default('tove-kyc')`) in `src/config/validation-schema.ts`; a missing/typo'd bucket now fails at boot
   instead of silently binding a default and 500-ing every upload. `src/config/kyc.config.ts` fallback noted
   as a dead `?? ''` (Joi guarantees the value). Build + lint + KYC e2e (8) green.
2. **Runbook produced:** `docs/solutions/deployment-issues/2026-07-17-kyc-submission-migration-deploy-gate.md`
   — full Go/No-Go checklist, required-env matrix, lock profile, verification SQL, monitoring signals, and
   rollback. This is the deploy-time gate for the ops prerequisites.
3. **RESTRICT-FK concern verified moot:** grep confirms **no hard-delete path for `users`** exists
   (`UsersService.softDelete` → `softRemove` only), so no job hits `23503` today. Documented in the runbook
   with a re-verify note for any future hard-purge/GDPR-erasure job.

Remaining acceptance items (master-key escrow, bucket creation + privacy, proxy body limit, post-deploy SQL)
are **deploy-time ops actions**, not code — they live as the runbook's 🔴 Pre-Deploy checklist and are the
deployer's Go/No-Go. `KYC_MASTER_KEY` is already Joi-required (crash-loops without it).

# KYC deploy prerequisites (data-protection critical) — master-key escrow, private bucket, proxy limit

## Problem Statement
PR #30 makes `POST /api/v1/me/kyc/submissions` live on deploy (it's in `PUBLIC_MODULES`) and migrations
auto-run on boot. Several **hard prerequisites** must be satisfied before rollout or the deploy either
crash-loops, silently 500s every submit, or exposes PII. These are ops/runbook items (not code changes),
but they are data-protection critical, hence P1. **This todo is a Go/No-Go checklist, not a code fix.**

## Findings
- **Master key (crash-loop + unrecoverable):** `KYC_MASTER_KEY` is Joi-`required()` and must decode to exactly 32 bytes (`src/config/validation-schema.ts` KYC block). A pod without it never becomes healthy. It wraps every per-document DEK — **lose it and 100% of KYC blobs are permanently undecryptable** for the 7-yr retention window.
- **Private bucket prereq:** `src/modules/kyc/kyc.module.ts` KYC_STORAGE factory binds to `kycCfg.bucket`; nothing creates/verifies it. Missing bucket ⇒ green pod but every submit fails at upload (silent 500 storm). A **public** bucket = PII-ciphertext exposure keyed by predictable `storage_key`.
- **Proxy body limit:** 4×10MB (`src/modules/kyc/kyc-file.validator.ts:7`) + multipart ≈ 48MB. If nginx/ALB/gateway cap < ~48MB, large submits 413 at the proxy before Multer, with no KYC error code.
- **RESTRICT-FK vs hard-delete jobs:** all KYC FKs are `ON DELETE RESTRICT` (migration). Any existing hard user-purge / GDPR-erasure job will now throw `23503` on users/submissions with KYC rows.
- `KYC_STORAGE_BUCKET` defaults to `tove-kyc` — a typo'd/omitted env silently binds the default name rather than failing (runtime-only failure if prod's bucket differs).

## Proposed Solutions
### Option A (recommended): pre-deploy checklist + runbook (no code)
- Provision `KYC_MASTER_KEY` in the secret manager (not env-file plaintext) + a **break-glass escrow copy** in a separate vault; record its checksum in the runbook so a truncated paste is caught pre-deploy.
- Set `KYC_STORAGE_BUCKET` explicitly; verify the bucket exists AND `public=false` via Supabase before rollout.
- Raise reverse-proxy body limit ≥ 48MB on the `me/kyc` path.
- Confirm no job hard-deletes `users`; document KYC PII erasure as a manual, retention-gated procedure.
- **Effort: Small (ops).**

### Option B (optional code hardening, separate todo)
- Boot-time assertion that the configured bucket exists (fail fast instead of silent 500s); make `KYC_STORAGE_BUCKET` required (no default) in prod. **Effort: Small–Medium.**

## Recommended Action
_(triage — Option A is mandatory before any prod deploy.)_

## Technical Details
- Full Go/No-Go checklist + verification SQL (column defaulted, CHECK validated, 3 indexes present, `octet_length(encrypted_dek)=60`) and rollback procedure were produced by the deployment-verification agent; paste into the deploy ticket.
- Rollback = **code-only** (schema is additive/forward-compatible); never `migration:revert` (prod-blocked `down()`); or hotfix-remove `PublicKycModule` from `PUBLIC_MODULES` to disable the endpoint without a schema change.

## Acceptance Criteria
- [x] Code guardrail: `KYC_STORAGE_BUCKET` required (no silent default) so a misconfig fails at boot. ✅
- [x] Deploy-gate runbook produced with env matrix, verification SQL, monitoring, rollback. ✅
- [x] No hard-delete-users job will hit the RESTRICT FKs (verified: soft-delete only); erasure documented. ✅
- [ ] _(deploy-time ops — in the runbook's 🔴 Pre-Deploy gate)_ `KYC_MASTER_KEY` set + escrowed + checksum-verified.
- [ ] _(deploy-time ops)_ `tove-kyc` bucket exists and confirmed private; `KYC_STORAGE_BUCKET` set explicitly.
- [ ] _(deploy-time ops)_ Proxy body limit ≥ 48MB on the KYC path (verified with a >40MB upload).
- [ ] _(deploy-time ops)_ Post-deploy verification SQL run and green.

## Work Log
- 2026-07-17: Filed from PR #30 review (deployment-verification P1-1/P1-2/P1-3/P2-2). No code changed.
