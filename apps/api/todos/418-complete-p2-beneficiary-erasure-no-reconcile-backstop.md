---
status: complete
priority: p2
issue_id: 418
tags: [code-review, tov-31, pr-54, security, compliance, data-integrity, erasure]
dependencies: []
---
# Account-erasure of third-party beneficiary PII is best-effort with no reconciliation backstop (and writes no audit)

## Resolution (2026-08-26)
Option A. Added a **repeatable BullMQ erasure-reconcile sweep** mirroring `kyc-orphan-sweep`, under
`src/modules/users/beneficiary/erasure-sweep/` (constants + service + processor + scheduler + provider-only
module, imported in `app.module`). On its cron it bulk hard-deletes any beneficiary whose owning user is
soft-deleted — new repo method `deleteOrphansOfDeletedUsers()` (`DELETE … WHERE user_id IN (SELECT id FROM
users WHERE deleted_at IS NOT NULL)`, returns affected count) — closing both the transient-failure and the
crash-between-softDelete-and-purge windows the best-effort per-account purge leaves open. New
`beneficiary.config.ts` (`BENEFICIARY_ERASURE_SWEEP_ENABLED` default true / `_CRON` daily 04:00), registered
in `app.module` config load + Joi `validation-schema.ts`; disabled in the e2e vitest env. Integration test
`erasure sweep: purges beneficiaries whose owning user is soft-deleted, leaves live ones`. Build 0 issues;
lint clean; beneficiary integration 10/10; e2e 5/5 (AppModule boots with the module).
**Finding #3 (erasure path writes no audit):** left as-is — consistent with `ProfileErasureService`; the
account-level delete is audited separately and the payload would carry no new information (keys-only).

## Problem Statement
The entire third-party-PII (name/email/notes) erasure guarantee for a deleted account rests on a single **best-effort** call — `BeneficiaryErasureService.purgeForUser` — that swallows and logs every error and never rethrows, with **no reconciler/retry/sweeper** behind it. Because `UsersService.softDelete` only sets `deleted_at`, the migration's FK `ON DELETE CASCADE` never fires, so a transient failure (DB blip, pool exhaustion) during purge leaves a non-consenting third party's name/email/notes in the table **indefinitely** — a right-to-erasure gap — with only a log line as evidence. A crash between `usersService.softDelete(id)` and `beneficiaryErasure.purgeForUser(id)` (two separate awaited calls, no shared txn) has the same effect.

## Findings
1. **Best-effort, error-swallowing purge, no backstop.** `src/modules/users/beneficiary/beneficiary-erasure.service.ts:19-26` (`try { deleteByUserId } catch { logger.error }`). Flagged by data-integrity-guardian (**P2**), security-sentinel (P3), architecture-strategist (P3). Unlike `ProfileErasureService` — whose soft-deleted image rows a **reaper later reclaims** — the beneficiary path has no equivalent sweep, so a failed purge is permanent.
2. **Non-transactional two-step in the controller.** `src/modules/backoffice/users/backoffice-users.controller.ts:81-89` runs `softDelete` then `purgeForUser` as separate awaits; a crash in between orphans the PII.
3. **Erasure path writes no audit row.** `beneficiary-erasure.service.ts:21` hard-deletes with no `internal_audit_log` entry, so the one place PII is erased for compliance leaves no keys-only trace (architecture P3). Precedent-consistent with `ProfileErasureService`, but worth confirming the user-level delete audit is considered sufficient coverage.

## Proposed Solutions
### Option A — Add a periodic reconcile sweep (Recommended)
A repeatable job (or extend an existing maintenance sweeper) that hard-deletes any `beneficiaries` row whose `user_id` points at a soft-deleted user (`SELECT b.id FROM beneficiaries b JOIN users u ON u.id=b.user_id WHERE u.deleted_at IS NOT NULL`). Closes both the transient-failure and crash-window gaps. Effort: Medium · Risk: Low.
### Option B — Alert-only
Keep best-effort, but emit a monitored metric/alert on the `failed to erase beneficiary for deleted user` log so a human reconciles. Add the orphan-detection query to monitoring. Effort: Small · Risk: Low (relies on human follow-up).
### Option C — Accept as-is, document
Consciously accept the ProfileErasure-parity tradeoff and document the residual retention risk. Effort: None · Risk: the compliance gap remains.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/beneficiary/beneficiary-erasure.service.ts`, `src/modules/backoffice/users/backoffice-users.controller.ts`, migration `1716000000050`.
- Monitoring tripwire (also see #420): `SELECT count(*) FROM beneficiaries b JOIN users u ON u.id=b.user_id WHERE u.deleted_at IS NOT NULL` must be 0.

## Acceptance Criteria
- [ ] A failed erasure is either retried/reconciled or actively alerted (not just logged).
- [ ] Orphan-detection query wired into monitoring, or a decision recorded that best-effort is acceptable.

## Work Log
- 2026-08-26: Filed from PR #54 multi-agent code review (data-integrity P2, security/architecture P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
- Precedent: `src/modules/users/profile/profile-erasure.service.ts` (has a reaper; beneficiary does not)
