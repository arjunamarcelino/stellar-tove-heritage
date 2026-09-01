---
status: complete
priority: p3
issue_id: 194
tags: [code-review, security, privacy, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A
`SupabaseStorageService` now redacts object keys in its three error logs (upload/createSignedUrl/delete)
via a private `logKey(path)` helper: an **override bucket** (dedicated/sensitive, e.g. KYC — set via
`STORAGE_BUCKET_OVERRIDE`) logs a short `sha256:<12hex>` of the key instead of the raw
`{userId}/{submissionId}/{docType}`; the default `files` bucket keeps full non-PII slug keys for
debuggability. No `userId`/`docType` reaches general logs for KYC. Build + lint green.

# KYC storage errors log the full object path (userId + docType) into general app logs

## Problem Statement
`SupabaseStorageService` logs the full object path on upload/delete/signed-url errors. For the KYC bucket
the path is `{userId}/{submissionId}/{docType}`, so a storage error emits the raw `userId` and the KYC
`docType` (e.g. `selfie`) into general application logs — a PII/KYC-linkage sink likely outside the
controlled, encrypted, 7-yr-retained KYC boundary. No bytes/DEKs/hashes leak, so low severity.

## Findings
- `src/modules/storage/supabase-storage.service.ts:44,55,69` — `Failed to upload/delete/... ${path}`.
- `src/modules/kyc/kyc.util.ts:9` — `kycObjectKey = {userId}/{submissionId}/{docType}`.
- The `delete` failure (line 69, best-effort cleanup) is the most benign but still logs the path.

## Proposed Solutions
### Option A (recommended): redact the path for the KYC provider
- Log only a non-identifying token for KYC-storage errors — e.g. `submissionId` prefix + `docType`, or a hashed/elided path — so `userId` never reaches general logs. Could be a `logRedactor` hook on the KYC storage provider, or log the `storage_key` through the existing pino redaction. **Pros:** removes PII linkage from logs. **Cons:** touches shared `SupabaseStorageService` (or requires a KYC subclass/wrapper for logging). **Effort: Small.**

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/storage/supabase-storage.service.ts` logging (as used by the KYC bucket provider).

## Acceptance Criteria
- [ ] No KYC storage log line contains a raw `userId` (or full `{userId}/...` path).

## Work Log
- 2026-07-17: Filed from PR #30 review (security-sentinel P3-1). No code changed.
