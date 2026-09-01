---
status: complete
priority: p3
issue_id: 197
tags: [code-review, data-integrity, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A
`supersedes_submission_id` is now resolved **inside** `runInTransaction`, after the conditional `UPDATE`
acquires the row lock: `submissionRepo.findOne({ where: { userId }, order: { createdAt: 'DESC' } })` (before
the new row is inserted), linked only when the prior row was `rejected`. Same-user by the `userId` filter and
consistent under concurrent same-user submits (the row lock serializes them). Removed the pre-txn
`findLatestByUser` call from `submit()` (still used by `getStatus`). Documented the soft-delete-severs-chain
behavior on the repo interface (done in #190). Added an e2e test asserting a post-rejection resubmission's
`supersedes_submission_id` equals the prior submission id. Opted NOT to add the composite-FK DB guarantee
(Option B) — app-enforced same-user + the e2e is sufficient for MVP. Unit (13) + e2e (9) + build + lint green.

# KYC supersedes_submission_id: computed outside the txn + no DB same-user enforcement

## Problem Statement
The resubmission-lineage pointer `supersedes_submission_id` is resolved **before** the transaction and is
only app-enforced to be the same user's row. Two gaps: (1) under concurrent resubmits the value can be
stale/duplicated (the row lock is acquired later, in the txn), and (2) the self-FK enforces only
referential existence — a bug/future writer could point it at another user's submission and the DB would
accept it. Neither corrupts current behavior (the partial-unique pending index still prevents two pending
rows), but for a 7-yr-retained compliance table the lineage should be trustworthy.

## Findings
- `src/modules/kyc/kyc.service.ts:114-117` — `supersedes` resolved via `findLatestByUser(userId)` outside the `runInTransaction` block (the row lock via the conditional `UPDATE` is acquired later at `:141`).
- `src/database/migrations/1716000000025-CreateKycTables.ts:53-54` — `FK_kyc_submissions_supersedes` checks existence only; cannot enforce same-`user_id` or `status='rejected'`.
- `src/modules/kyc/repositories/kyc-submission.repository.ts:24-29` — `findLatestByUser` excludes soft-deleted rows, so soft-deleting a rejected submission silently severs it from a future supersession chain (acceptable, but undocumented).

## Proposed Solutions
### Option A (recommended): resolve supersedes inside the txn + add a same-user test
- Move the `findLatestByUser` lookup inside `runInTransaction` after the conditional `UPDATE` acquires the row lock, so the value is consistent under concurrency. Add a unit/integration test asserting a resubmission's `supersedes` always resolves to the acting user's own prior submission. Document that soft-delete severs the chain. **Effort: Small.**

### Option B: DB-level same-user guarantee
- Composite FK `(supersedes_submission_id, user_id) REFERENCES kyc_submissions(id, user_id)` (needs a unique index on `(id, user_id)`). **Pros:** DB-enforced. **Cons:** extra index + migration for a low-probability bug. **Effort: Medium.** Rank Option A sufficient for MVP.

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/kyc/kyc.service.ts`, `src/modules/kyc/repositories/kyc-submission.repository.ts` (comment), optionally the migration.

## Acceptance Criteria
- [ ] `supersedes` is computed consistently under concurrent same-user resubmits (or documented as best-effort with a test proving same-user).
- [ ] `findLatestByUser`'s soft-delete scoping (and its effect on the supersession chain) is documented.

## Work Log
- 2026-07-17: Filed from PR #30 review (data-integrity P3, security-sentinel P2-3). No code changed.
