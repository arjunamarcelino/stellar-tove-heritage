---
status: complete
priority: p3
issue_id: 188
tags: [code-review, performance, kyc, TOV-28]
dependencies: [187]
---

## Resolution (complete — 2026-07-17) — 2 of 3 parts
1. **Double HMAC removed:** `encryptDocument` no longer recomputes `blob_hash` (dropped `blobHash` from
   `EncryptedDocument`). The service computes the per-doc keyed hash ONCE (the fingerprint pass) and reuses
   `hashes[docType]` for both the fingerprint and the `kyc_documents` row. ~40MB of hashing/request saved.
2. **Uploads parallelized:** the 4 encrypt+upload units now run under `Promise.allSettled` (independent keys),
   ~4× lower upload wall-time. Cleanup keys off the *settled fulfilled* uploads, so a partial failure still
   deletes exactly the blobs that landed (unit test updated: 1-of-4 fails ⇒ 3 cleaned up).
3. **NOT done — "hash after the resubmit check":** deliberately skipped. The fingerprint feeds
   `idempotency.begin`, which MUST run before the resubmit-policy check (else a legitimate same-key replay
   409s instead of replaying — the bug fixed earlier). Moving the hashing after the resubmit check would
   require moving `begin` too, reintroducing that bug. The marginal saving (hashing on already-pending
   retries) isn't worth breaking replay ordering.

Crypto (11) + service (13) + validator (10) unit + KYC e2e (9) + build + lint green.

# KYC submit: double HMAC per doc, hashing before the resubmit check, and serial uploads

## Problem Statement
Three cheap, independent perf wins on the submit path: the plaintext HMAC is computed **twice** per
document, the ~40MB fingerprint hashing runs **before** the (advisory) resubmit-status check so
already-pending/approved retries still pay it, and the 4 blob uploads run **serially**.

## Findings
- **Double HMAC:** the fingerprint loop hashes each buffer at `src/modules/kyc/kyc.service.ts:74-76`, and `encryptDocument` independently hashes the same buffer again for `blobHash` at `src/modules/kyc/crypto/kyc-crypto.service.ts:64`. That's 4 extra 10MB HMACs (~40MB) of pure waste per request.
- **Ordering:** jurisdiction check (`kyc.service.ts:64`) is first (good, cheap), but the fingerprint hashing (`:74-76`) runs before the user lookup + `assertResubmitAllowed` (`:109-113`). An already-`pending_review`/`approved` user (classic resubmit spam) still burns ~40MB of HMAC before rejection. The idempotency-before-resubmit ordering is about the idempotency guarantee, not the hashing — the advisory status check can safely precede the hashing.
- **Serial uploads:** `kyc.service.ts:119-136` awaits `encryptDocument` then `storage.upload` for each of 4 docs strictly in series; the 4 independent ~10MB uploads could overlap (~4× upload wall-time), and serial execution holds the claimed idempotency sentinel + ~40MB heap longer.

## Proposed Solutions
### Option A: reuse the hash, reorder, parallelize
- Compute `blobHash` once during encryption and thread it into the fingerprint (or hash once up front and pass it in), removing the double HMAC.
- Move the user lookup + `assertResubmitAllowed` fast-path before the fingerprint hashing (still after jurisdiction), so rejected retries skip the hashing.
- Once crypto is off the main loop (see [187]), run the 4 encrypt+upload units with `Promise.all`, collecting `uploaded` keys from settled results for the existing `cleanup` path.
- **Pros:** removes ~40MB wasted hashing on rejected requests, ~4× faster uploads. **Cons:** the parallel-upload change interacts with [187]; do the reorder + de-dup independently now, parallelize with 187. **Effort: Small (de-dup + reorder), Medium (parallel upload).**

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/kyc/kyc.service.ts` (ordering + upload loop), `src/modules/kyc/crypto/kyc-crypto.service.ts` (hash reuse).
- The parallel-upload cleanup must key off the *settled* uploads to avoid a straggler landing a blob after cleanup ran.

## Acceptance Criteria
- [ ] Each document's plaintext is HMAC'd at most once per request.
- [ ] An already-pending/approved resubmit is rejected before the fingerprint hashing runs.
- [ ] The 4 uploads run concurrently (bounded) with correct partial-failure cleanup.

## Work Log
- 2026-07-17: Filed from PR #30 review (performance-oracle P2 items). No code changed.
