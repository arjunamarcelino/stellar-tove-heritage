---
status: complete
priority: p3
issue_id: 330
tags: [code-review, simplification, tov-160]
dependencies: []
---
# Simplify the settle-failure / re-drive CAS surface (collapse inverse stamps, guard the failure audit, reconsider the reclaim path)

## Problem Statement
The settle-failure and re-drive machinery carries three small, related simplification opportunities. (1) `casSettleFailed` and `casReclaimFailedSettle` are exact inverse stamp-writes on `subscribed` rows — one sets `settle_failed_at`/`reason`, the other clears them — and could be one method. (2) The processor's `fail()` discards the `casSettleFailed` boolean and then UNCONDITIONALLY writes an `OFFERING_SETTLE_FAILED` audit row; if the CAS no-ops (the row is already `settled`), a spurious failure audit is recorded against a successful settlement. (3) The whole failed-settle re-drive path (`casReclaimFailedSettle` + the `isRedrive` branch) may be heavier than necessary: a re-enqueued settle job already no-ops unless `status === 'subscribed'`, and `casSettled` clears the stamps on success, so a plain re-enqueue would settle without the reclaim CAS at all. None of this is money-unsafe (the settle txn is atomic and the CAS guards hold), but the surface is larger than the behavior requires.

## Findings
- `src/modules/offerings/repositories/offering.repository.ts:152-164` — `casSettleFailed(manager, id, reason)` sets `settle_failed_at = now()`, `settle_failure_reason = reason`.
- `src/modules/offerings/repositories/offering.repository.ts:165-180` — `casReclaimFailedSettle(manager, id)` sets `settle_failed_at = null`, `settle_failure_reason = null` (the exact inverse), guarded on `status = subscribed AND settle_failed_at IS NOT NULL`.
- `src/modules/offerings/repositories/offering.repository.ts:135-151` — `casSettled` already clears `settleFailedAt: null` on the success flip.
- `src/modules/offerings/settle/offering-settle.processor.ts:235-249` — `fail()` calls `casSettleFailed(...)` but ignores its boolean return, then always `audit.record(OFFERING_SETTLE_FAILED)`.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:407-410` + `:452-456` — the `isRedrive` discriminator (`status === 'subscribed' && settleFailedAt !== null`) drives the 409-vs-redrive decision and calls `casReclaimFailedSettle` on the re-drive branch.

## Proposed Solutions
### Option A — Collapse the inverse stamps + guard the failure audit
- Description: Replace `casSettleFailed` + `casReclaimFailedSettle` with one `setSettleFailureStamp(manager, id, reason: string | null)` (reason set → stamp; `null` → clear). In `fail()`, only write the `OFFERING_SETTLE_FAILED` audit when the stamp CAS actually applied: `if (await setSettleFailureStamp(m, id, reason)) audit(...)`.
- Pros: One method instead of two inverses; the failure audit can no longer be written against an already-`settled` row (even though that's unreachable at `concurrency:1`, it's a cheap correctness guard).
- Cons: A nullable-reason parameter is slightly less self-documenting than two named methods.
- Effort: Small
- Risk: Low

### Option B — Also drop the reclaim CAS, rely on re-enqueue + BullMQ attempts
- Description: Keep the `settleFailedAt` read as the in-progress-vs-failed discriminator (still needed for the 409-vs-redrive HTTP decision), but on re-drive just re-enqueue the settle job: the processor no-ops unless `status === 'subscribed'`, and `casSettled` clears the stamps on success, so the explicit reclaim CAS is not required to settle.
- Pros: Removes the reclaim CAS entirely; fewer moving parts.
- Cons: The failure stamp then lingers on the row until the next successful `casSettled` clears it (observable in reads between re-drive and success); needs care that no gate keys off `settle_failed_at` in a way that blocks the re-enqueued job.
- Effort: Small
- Risk: Medium

### Option C — Defer re-drive to an admin runbook
- Description: Drop the auto re-drive path; document a manual admin re-drive (matches the TOV-156 "no reconciler, manual stuck-bid handling" precedent).
- Pros: Smallest code surface; consistent with the sibling feature's precedent.
- Cons: Loses automated recovery for the crash-between-commit-and-enqueue window that the stale-subscribed sweep covers (see 331); shifts load to ops.
- Effort: Small
- Risk: Medium

## Recommended Action
Option A now (collapse the two inverse stamps into one nullable-reason method and guard the `OFFERING_SETTLE_FAILED` audit behind the CAS result). Evaluate Option B (drop the reclaim CAS in favor of plain re-enqueue) as a follow-up once it's confirmed no read/gate depends on the failure stamp being cleared synchronously; keep the `settleFailedAt` read as the 409-vs-redrive discriminator either way.

## Technical Details
The double-write is unreachable at the processor's `concurrency: 1`, so Option A's audit guard is defense-in-depth, not a live bug fix. For Option B, verify the settle enqueue/gate never filters on `settle_failed_at IS NULL` in a way that would starve a re-driven row.

## Acceptance Criteria
- One stamp method (`setSettleFailureStamp` or equivalent) replaces the `casSettleFailed`/`casReclaimFailedSettle` inverse pair, or a note records why they stay split.
- `fail()` writes the `OFFERING_SETTLE_FAILED` audit only when the failure stamp CAS applied.
- The 409-vs-redrive HTTP behavior (in-progress → 409, terminally-failed → re-drive) is unchanged and still tested.

## Work Log
- 2026-08-20: created from PR #43 code-simplicity-reviewer + data-integrity-guardian review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Per the chosen scope (collapse the CAS + guard the audit; KEEP the settle-reconcile separate — see #331/#334):
(1) Collapsed the two inverse CAS methods (`casSettleFailed` + `casReclaimFailedSettle`) into one
`setSettleFailureStamp(manager, id, reason: string | null)` — reason!=null STAMPS the terminal failure,
reason==null RECLAIMS (clears), with the reclaim keeping its `settle_failed_at IS NOT NULL` guard so it only
ever touches a genuinely-failed row. (2) Guarded `fail()`'s `OFFERING_SETTLE_FAILED` audit on the CAS result
(`if (!stamped) return;`) so a no-op stamp (row already `settled`) can't write a spurious failure audit
against a successful settlement. Updated the processor + settle-service callers and their spec mocks/asserts.
The re-drive path itself is kept (it's the admin recovery lane) but is now backed by the single method.
Build green; processor 7/7 + settle service 14/14.
