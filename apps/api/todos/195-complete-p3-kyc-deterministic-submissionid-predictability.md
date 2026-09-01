---
status: complete
priority: p3
issue_id: 195
tags: [code-review, security, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A (secret-key the derivation)
Moved `deterministicSubmissionId` out of the pure `kyc.util.ts` into `KycCryptoService`, where it is now an
**HMAC** keyed by an HKDF-derived subkey (`info='kyc-submission-id'`, separate domain from the KEK/blob-hash
key) over `${userId}:${idempotencyKey}` — so the id is no longer reconstructable from client-known values,
while staying deterministic for idempotent-retry reuse (RFC-4122 v5-shaped). `KycService` now calls
`this.crypto.deterministicSubmissionId(...)`. Corrected the false "UUIDs are unguessable" comment on
`kycObjectKey`. Added a crypto unit test (deterministic + secret-keyed + valid UUID). All KYC unit (34) +
KYC e2e (8, incl. the idempotent-replay test that depends on a stable id) + build + lint green.

# KYC deterministic submissionId is predictable; the "unguessable" comment is false

## Problem Statement
`deterministicSubmissionId` derives a UUIDv5-shaped id from `sha256("tov28-kyc:{userId}:{idempotencyKey}")`
with **no secret**. The comment claims "UUIDs are unguessable, so the path is not enumerable," but the id
is a pure function of two client-known values — anyone who knows a target `userId` (they appear in JWTs /
other responses) and the idempotency key can reconstruct the exact `storage_key`. Today only the private
bucket + service-role-only access prevent enumeration (ownership is enforced on all reads), so this is
defense-in-depth, but the code's own justification is wrong and it becomes an IDOR enabler if a future
signed-URL read path ever trusts key unguessability instead of an ownership check.

## Findings
- `src/modules/kyc/kyc.util.ts:18-25` — `createHash('sha256').update(`tov28-kyc:${userId}:${idempotencyKey}`)`, no secret.
- `src/modules/kyc/kyc.util.ts:7` — comment "UUIDs are unguessable, so the path is not enumerable" (false for this derived id).

## Proposed Solutions
### Option A (recommended): mix in a server secret + fix the comment
- Derive via HMAC with the master key (or an HKDF-derived subkey) instead of bare SHA-256, so the id is not reconstructable from client-known values. Correct the comment to say the id is deterministic-but-secret-keyed and that reads are ownership-checked regardless. **Pros:** removes the predictability + false claim. **Cons:** none material (id stays deterministic for idempotent-retry reuse). **Effort: Small.**

### Option B: keep derivation, fix the comment + enforce ownership everywhere
- Accept predictability (bucket is private, reads are `userId`-scoped), correct the comment, and add a hard rule/test that any future read path checks `submission.userId === caller.sub` (never trusts the key). **Effort: Small.**

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/kyc/kyc.util.ts`. Coordinate with the future document-read ticket ([198]).

## Acceptance Criteria
- [ ] The `submissionId`/`storage_key` is not reconstructable from client-known values alone, OR the comment is corrected and every read path is proven to enforce ownership.

## Work Log
- 2026-07-17: Filed from PR #30 review (security-sentinel P3-2). No code changed.
