---
status: complete
priority: p3
issue_id: 289
tags: [code-review, TOV-154, PR-39, correctness, expiry]
dependencies: []
---

# Approval expiry over-expires still-valid sub-quorum votes when threshold > 2

## Problem Statement
`findExpiredOfferingIds` selects an offering for expiry if **any** live approval is older than the TTL
(`WHERE oa.created_at < now() − ttl`), and `sweepExpiry` then soft-deletes **all** of that offering's
live approvals. This is an *attempt-window* semantics anchored at the first signature: once the oldest
signature ages out, the whole in-progress quorum is wiped.

Benign at the default `threshold=2 / roster=3` (two approvals reach quorum and deploy, so approvals never
linger long enough to trip the cutoff). But with `threshold >= 3` it over-expires: signer A approves on
day 0, signer B approves on day 6 (count `2 < 3`, still `planned`); on day 8 A's row trips the cutoff →
the offering is selected → **B's 2-day-old approval is wiped too**, even though B never expired.

## Findings
- **data-integrity-guardian (LOW/P3):**
  `src/modules/offerings/repositories/offering-approval.repository.ts:83-96` (`findExpiredOfferingIds`)
  selects any offering with `MIN(oa.created_at) < now() − ttl` semantics via the row-level
  `oa.created_at < now() − make_interval(...)` predicate, and `sweepExpiry`
  (`src/modules/offerings/deploy/offering-reconcile.processor.ts:74-99`) calls
  `softDeleteAllForOffering` (`offering-approval.repository.ts:64-71`) which soft-deletes the entire live
  set. If the intent is a **per-signature** TTL rather than an **attempt-wide** window anchored at the
  first signature, this over-expires still-valid votes once `threshold > 2`.
- The rest of the query is correct: `GROUP BY oa.offering_id` + `ORDER BY MIN(oa.created_at) ASC` +
  the roster-agnostic count are all fine — only the *anchoring semantics* are in question.
- Only matters if `OFFERING_APPROVAL_THRESHOLD` is ever set `> 2` (default is 2, roster 3, per
  `src/config/offering-escrow.config.ts`).

## Proposed Solutions
### Option A — Keep attempt-window semantics (anchored at first signature) and document it
- Treat "expire the whole in-progress quorum once the first signature ages out" as intended: a stale
  approval attempt is abandoned wholesale and a fresh quorum must restart. Add a code comment + a test
  asserting the behavior so it is deliberate, not incidental.
- **Pros:** no logic change; simple mental model (one TTL clock per attempt). **Cons:** a late signer's
  fresh vote is discarded when threshold `> 2`; mildly surprising. **Effort:** Trivial.
  **Risk:** Low (default threshold=2 never hits it).

### Option B — Switch to per-signature expiry
- Only soft-delete the approval rows that are themselves older than the TTL, then re-evaluate quorum from
  what remains (an offering with all live rows aged out effectively resets). `softDeleteAllForOffering`
  becomes `softDeleteExpiredForOffering(ttl)`; the selection predicate and the delete predicate share the
  same per-row cutoff.
- **Pros:** each signature has its own honest TTL; a late valid vote survives. **Cons:** more moving
  parts; must define what "quorum from what remains" means and test it; the "one clock per attempt"
  simplicity is lost. **Effort:** Small–Medium. **Risk:** Low–Medium.

## Recommended Action
Decide the anchoring semantics explicitly. If the product intent is "one expiry clock per approval
attempt," take **Option A** and document + test it. If signatures should each carry their own TTL, take
**Option B**. Either way, note that this is inert unless `OFFERING_APPROVAL_THRESHOLD > 2`.

## Technical Details
- `src/modules/offerings/repositories/offering-approval.repository.ts`: `findExpiredOfferingIds`
  (~83-96), `softDeleteAllForOffering` (~64-71)
- `src/modules/offerings/deploy/offering-reconcile.processor.ts`: `sweepExpiry` (~74-99)
- `src/config/offering-escrow.config.ts`: `OFFERING_APPROVAL_THRESHOLD` (default 2), `ttlDays`

## Acceptance Criteria
- [x] The approval-expiry anchoring semantics are decided and documented.

## Resolution (2026-08-20 — "document as intended attempt-window", per requester)
No behavior change. The semantics are **intended**: expiry is an attempt window anchored at the first
signature — an offering is selected once any live approval ages past the TTL, and the whole set is cleared so
a fresh quorum restarts. This is correct at the configured `threshold = 2` (two approvals reach quorum and
deploy before a set can linger), and the new `OFFERING_APPROVAL_THRESHOLD` floor of 2 (todo 284) keeps it
there. Documented the semantics + the "revisit at threshold > 2 (switch to per-signature TTL)" trigger in a
comment on `findExpiredOfferingIds`. Existing integration coverage (I8 / I8b) already pins the finder's
status + TTL + mid-deploy-exclusion behavior. Build + lint green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review. data-integrity-guardian LOW/P3: attempt-window
  expiry over-expires still-valid sub-quorum votes when `threshold > 2`; benign at the default
  threshold=2/roster=3.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
