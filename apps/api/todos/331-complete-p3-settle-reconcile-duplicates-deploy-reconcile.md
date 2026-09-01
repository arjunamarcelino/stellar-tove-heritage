---
status: complete
priority: p3
issue_id: 331
tags: [code-review, simplification, architecture, tov-160]
dependencies: []
---
# The settle-reconcile apparatus duplicates the existing deploy-reconcile "find-stale → best-effort re-enqueue" pattern

## Problem Statement
TOV-160 adds a whole fourth reconcile apparatus — `OfferingSettleReconcileProcessor` + `OfferingSettleReconcileScheduler` + the `OFFERING_SETTLE_RECONCILE_QUEUE` constant (two of the four files under `settle/`) — to perform the exact same "find stale rows → best-effort `queue.add` per row, log-and-continue on failure" pattern that the existing `OfferingReconcileProcessor` (under `deploy/`) already runs for three sweeps. That existing processor already injects a BullMQ queue and already owns the repeatable-cron + enable-toggle plumbing. The new settle-reconcile is a near-verbatim copy differing only in the finder (`findStaleSubscribed` vs `findStaleDeploying`) and the target queue. This is a duplication / architecture-consolidation question, not a correctness defect — both apparatuses work.

## Findings
- `src/modules/offerings/settle/offering-settle-reconcile.processor.ts:24-64` — the new processor: `findStaleSubscribed` → best-effort `settleQueue.add` per row, log-and-continue.
- `src/modules/offerings/settle/offering-settle-reconcile.scheduler.ts:14-31` — the new scheduler, reusing the SAME `reconcileEnabled`/`reconcileCron` toggle as the deploy reconcile.
- `src/modules/offerings/deploy/offering-reconcile.processor.ts:32-134` — the existing single reconcile owner running three sweeps (`sweepStaleDeploying`, `sweepWindowOpen`, `sweepExpiry`); `sweepStaleDeploying` (53-77) is structurally identical to the new settle sweep and already injects `deployQueue`.
- `src/modules/offerings/offering.constants.ts:11,14,17` — `OFFERING_RECONCILE_QUEUE`, `OFFERING_SETTLE_QUEUE`, `OFFERING_SETTLE_RECONCILE_QUEUE`; consolidation would delete the third.

## Proposed Solutions
### Option A — Add a fourth sweep to the existing `OfferingReconcileProcessor`
- Description: Add `sweepStaleSubscribed` (using `findStaleSubscribed`) to `OfferingReconcileProcessor`, injecting the settle queue alongside the deploy queue. Delete `offering-settle-reconcile.processor.ts`, `offering-settle-reconcile.scheduler.ts`, the `OFFERING_SETTLE_RECONCILE_QUEUE` constant, and its module registration.
- Pros: One reconcile owner (matches the "single reconcile owner" comment in the deploy processor); removes two files + a queue + a scheduler; reuses the existing cron/enable plumbing that the new scheduler already borrows.
- Cons: Adds one cross-module queue-injection edge (the reconcile processor, homed under `deploy/`, would inject the settle queue); one processor now spans deploy + settle recovery.
- Effort: Small
- Risk: Low

### Option B — Keep the settle-reconcile separate (status quo)
- Description: Leave the fourth apparatus as-is.
- Pros: Clean separation of money-settlement recovery from deploy recovery; an independent enable toggle is possible later (see 333/config); the settle sweep lives in the module that owns `OFFERING_SETTLE_QUEUE`, avoiding the cross-module queue edge (the reason cited in the processor's own doc comment).
- Cons: Two near-identical apparatuses; the same pattern maintained in two places.
- Effort: None
- Risk: Low

## Recommended Action
Weigh against the codebase's own precedent: the deploy reconcile deliberately consolidated THREE distinct sweeps (stale-deploying, window-open, approval-expiry) into ONE processor, so a fourth sweep is the established pattern and Option A is the consistent choice. Recommend Option A (fold `findStaleSubscribed` into `OfferingReconcileProcessor`), accepting the single cross-module queue-injection edge, UNLESS an independent settle-reconcile enable toggle is a near-term requirement — in which case Option B's separation is justified. Decide alongside the config-toggle question in the related config finding.

## Technical Details
The new scheduler already reuses `offeringEscrowConfig.reconcileEnabled`/`reconcileCron`, so consolidation loses no independent knob today. The processor's own comment ("Lives in the settle worker module ... NOT the deploy reconcile") documents the cross-module-edge tradeoff that Option A accepts.

## Acceptance Criteria
- A decision is recorded (consolidate vs keep-separate) with the cross-module-edge tradeoff noted.
- If consolidated: `findStaleSubscribed` runs as a sweep of `OfferingReconcileProcessor`; the two settle-reconcile files + `OFFERING_SETTLE_RECONCILE_QUEUE` + its scheduler registration are removed; the stale-subscribed re-drive still fires on the repeatable cron and is covered by a test.

## Work Log
- 2026-08-20: created from PR #43 code-simplicity-reviewer + architecture-strategist review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20) — DECISION: keep separate
Reviewed and DECIDED to keep the settle-reconcile (queue + scheduler + processor) SEPARATE from the deploy
reconcile rather than fold `findStaleSubscribed` into `OfferingReconcileProcessor`. Rationale: money-settlement
recovery is a distinct operational risk surface that benefits from independent control + isolation, and the
architecture reviewer flagged keep-separate as defensible; merging would couple deploy and settlement recovery
and reach across modules for the settle-queue injection. The real sub-issue the review raised — that the two
sweeps SHARED one enable toggle — is fixed in #334 (added `OFFERING_SETTLE_RECONCILE_ENABLED`). No further code
change; documented the deliberate duplication.
