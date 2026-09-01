---
status: complete
priority: p2
issue_id: 200
tags: [code-review, performance, quality, kyc, TOV-29, PR-31]
dependencies: []
---

# getWhitelistStatus: skip needless `findLatestByUser` for `not_submitted`, and fix the misleading "single-snapshot" docstring

## Problem Statement
Two related issues on the same read method, surfaced by the performance and data-integrity reviews:

1. **Redundant query under polling.** `getWhitelistStatus` always issues a second DB round-trip
   (`findLatestByUser`) even when the user is `not_submitted` — the largest pre-KYC cohort on a card
   that polls every ~5s. For that cohort the query can only return `null` (no submission can exist),
   so it is pure wasted traffic. Skipping it eliminates ~half the endpoint's DB queries for the common
   case at zero contract cost (the DTO already tolerates `latest === null`).

2. **Docstring overstates consistency.** The method comment says it reads "status + the gated fields
   from the SAME user row" — but the response is assembled from **two separate autocommit reads**
   (`users.findOne` then `findLatestByUser`) with no shared snapshot. A concurrent submit can interleave,
   producing a momentarily torn view (e.g. `status: not_submitted` with a fresh `lastSubmissionAt`).
   This is a benign UX-level inconsistency on a read-only card (the two fields are deliberately
   decoupled axes), but the comment claims a guarantee the code doesn't provide.

## Findings
- `src/modules/kyc/kyc.service.ts:254-264` — `const latest = await this.submissions.findLatestByUser(userId);` runs unconditionally (performance-oracle P2).
- `src/modules/kyc/kyc.service.ts:250-252` — docstring "Single projection reads status + the gated fields from the SAME user row" overstates the two-query read (data-integrity P2).
- Index coverage for `findLatestByUser` is confirmed optimal (`IDX_kyc_submissions_user_created`), so the concern is *query count*, not per-query cost.

## Proposed Solutions
### Option A (recommended): short-circuit + comment fix
```ts
const latest =
  user.kycStatus === KycStatus.NOT_SUBMITTED
    ? null
    : await this.submissions.findLatestByUser(userId);
```
and soften the docstring to note the two-query read is eventually-consistent (`lastSubmissionAt` is
advisory). **Effort: Small.** Removes ~half the polling traffic for the biggest cohort.

### Option B: single-snapshot transaction
Wrap both reads in a `REPEATABLE READ` transaction so the docstring's claim becomes true. Adds a txn to
a hot read path for a guarantee the card doesn't need. **Effort: Small–Medium.** Not recommended.

## Recommended Action
**RESOLVED — docstring fixed; the query-skip was REJECTED as incorrect.** The proposed
`status === NOT_SUBMITTED → skip findLatestByUser` optimization is a **correctness bug**, not a safe
optimization: `status` and the submission are decoupled axes — a rejected collector folds back to
`not_submitted` while *keeping* their (rejected) submission row (this is exactly what the E1 decoupling
integration test asserts: a `not_submitted` user WITH a submission must still report `lastSubmissionAt`).
Skipping the query by status would drop `lastSubmissionAt` for those users. The performance finding rested
on the false premise `not_submitted ⇒ no submission`. So the second read stays unconditional; added an
explicit comment documenting *why* it can't be skipped. The misleading "single snapshot / SAME user row"
docstring was corrected to state the two-query eventually-consistent reality.

## Technical Details
- Affected: `src/modules/kyc/kyc.service.ts:250-264`.
- No API/contract change; `lastSubmissionAt` stays `null` for `not_submitted` (already the case).

## Acceptance Criteria
- [ ] `not_submitted` reads issue exactly one query (no `findLatestByUser`).
- [ ] The method comment no longer claims a single-snapshot/same-row read.

## Work Log
- 2026-07-17: Filed from PR #31 review (performance-oracle P2, data-integrity P2). No code changed.
- 2026-07-17: RESOLVED. `kyc.service.ts` getWhitelistStatus docstring corrected + comment added explaining the second read cannot be status-skipped (decoupling). Query-skip optimization rejected (would break E1). build/lint/integration green. Status → complete.
