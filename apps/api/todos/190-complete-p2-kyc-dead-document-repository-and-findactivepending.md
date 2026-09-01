---
status: complete
priority: p2
issue_id: 190
tags: [code-review, quality, architecture, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A (delete)
Deleted the unused surface. Removed `kyc-document-repository.interface.ts` + `kyc-document.repository.ts`,
the `KYC_DOCUMENT_REPOSITORY` provider from `kyc.module.ts`, and `findActivePendingByUser` from the
submission repo + its interface (documents are persisted via `manager.getRepository(KycDocument)` inside
the txn, which is required for atomicity; the resubmit guard reads `users.kyc_status`). Fixed the
interface docstring's false "advisory fast-path … agree" claim. Updated the integration test: dropped the
doc-repo wiring, replaced the two dead finder tests with one that asserts the real index behavior (a
soft-deleted pending row releases the pending slot), and inserts the RESTRICT-FK test doc via
`dataSource.getRepository(KycDocument)`. Build + lint + 7 KYC integration tests green.

# KYC: unused KycDocumentRepository stack + dead findActivePendingByUser (tested-but-unused surface)

## Problem Statement
A whole repository stack (`KYC_DOCUMENT_REPOSITORY` token + interface + class + module provider) and the
`findActivePendingByUser` finder are never consumed by production code — only by an integration test.
Documents are written via `manager.getRepository(KycDocument)` inside the transaction, and the resubmit
guard reads `users.kyc_status` (not `findActivePendingByUser`). This is dead surface that tests keep
alive, and the finder's doc claims an invariant ("advisory fast-path and DB backstop agree") the live
code doesn't actually exercise (the fast-path reads a *different table* than the race-index).

## Findings
- `src/modules/kyc/repositories/kyc-document-repository.interface.ts` (bare marker type) + `src/modules/kyc/repositories/kyc-document.repository.ts` + provider at `src/modules/kyc/kyc.module.ts:44` — `KYC_DOCUMENT_REPOSITORY` is never injected; the service persists docs via `manager.getRepository(KycDocument)` (`kyc.service.ts:167-168`), which is required for atomicity.
- `src/modules/kyc/repositories/kyc-submission.repository.ts:17-21` (`findActivePendingByUser`) + interface `:12` — only referenced by `test/integration/modules/kyc/kyc.repository.integration.spec.ts`; `submit()`/`getStatus()` never call it.
- Latent hazard: if `users.kyc_status` and the pending-submission row ever diverge (e.g. admin flips status without soft-deleting the row), the advisory check passes but the DB index throws 23505 → remapped to ALREADY_PENDING (handled safely at `kyc.service.ts:185`, but the "two guards agree" claim is untrue).

## Proposed Solutions
### Option A (recommended): delete the dead surface
- Remove the `KycDocument` repository interface/class/token/provider and the `findActivePendingByUser` method (+ their integration-test blocks). Persistence stays on the entity-manager repo inside the txn. The later admin-review/read-back ticket adds a repo *with the methods it needs*. **Pros:** ~22 src LOC + a token gone; no speculative surface. **Cons:** the read ticket re-adds a repo (cheaply, with real methods). **Effort: Small.**

### Option B: wire them in to make the docs true
- Route the in-txn document write through the injected repo (must still accept the `manager`) and use `findActivePendingByUser` as the resubmit guard so the "two guards agree" invariant is real. **Pros:** keeps the abstract-repo pattern. **Cons:** more code for no functional gain; the manager-threading is the awkward part. **Effort: Medium.**

### Option C: keep code, fix only the misleading doc + add a divergence test
- Drop the interface comment's "advisory fast-path … agree" claim and add a test that `users.kyc_status='pending_review'` ⟺ a live pending submission row exists. **Effort: Small.**

## Recommended Action
_(triage — Option A unless the read ticket is imminent.)_

## Technical Details
- Affected: the two `kyc-document*` repo files, `kyc.module.ts:20-21,44`, `kyc-submission.repository.ts:17-21` + its interface, and `test/integration/modules/kyc/kyc.repository.integration.spec.ts`.

## Acceptance Criteria
- [ ] No production-unused repository token/class/method remains (or it is wired into a real production path).
- [ ] No interface docstring claims an invariant the code doesn't exercise.
- [ ] Build + full test suite stay green after removal/rewiring.

## Work Log
- 2026-07-17: Filed from PR #30 review (code-simplicity F1, data-integrity P2, kieran #2/#3). No code changed.
