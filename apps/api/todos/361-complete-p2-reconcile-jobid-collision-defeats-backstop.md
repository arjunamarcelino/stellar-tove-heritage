---
status: complete
priority: p2
issue_id: 361
tags: [code-review, reliability, bullmq, tov-174, pr-47]
dependencies: []
---
# Reconcile backstop is silently defeated by a BullMQ `jobId` collision with a retained failed job (PR #47)

## Problem Statement
The `rfq-fanout` reconcile loop is the crash-backstop that upholds the 99%/60s delivery SLA. But it only
recovers the *narrow* "enqueue never issued" case (crash between commit and `queue.add`). It does **not**
recover the more common **retry-exhaustion** case, because the reconcile re-enqueues with the same
`jobId=rfqId` as a **retained failed job**, and BullMQ treats an `add` with an existing jobId as a
deduplicated no-op. The result: for any RFQ whose fan-out exhausts its 5 retries, all holder notifications
are **permanently lost**, the SLA is breached, and there is no dead-letter alert — while reconcile logs
`"re-enqueued N un-latched RFQ(s)"` even though every `add` was a silent no-op (a misleading ops signal).

## Findings
Source: data-integrity-guardian (HIGH). Corroborated by the BullMQ framework research done during planning,
which noted jobId re-fires only after a **completed** job is reaped — it did NOT cover a **retained failed**
job, which is what breaks here.

Failure scenario:
1. RFQ created; primary fan-out job enqueued `jobId=rfqId`, `attempts:5` exp backoff (~62s total horizon),
   `removeOnFail: { age: 86400 }` (24h).
2. The pure-DB fan-out txn fails all 5 attempts (a >~60s DB blip / pool exhaustion / deadlock). Job → the
   **failed** set, retained 24h. `rfqs.fanned_out_at` is still NULL (txn rolled back).
3. Reconcile (every 60s) `findUnfannedSince` returns the un-latched RFQ and calls
   `fanoutQueue.add(JOB, {rfqId}, { jobId: rfqId, … })`.
4. The retained failed job still occupies `jobId=rfqId` → BullMQ returns it, does NOT re-run. No
   `queue.remove()/.retry()/.promote()` exists anywhere in the module (grep-clean).
5. The failed job is only evictable at ~24h (`age: 86400`) — **exactly** when the RFQ also ages out of the
   24h reconcile window (`created_at >= now − reconcileWindowMs`, default 86_400_000). The horizons coincide,
   so there is effectively **no window** in which reconcile can re-drive the job.

Locations:
- `src/modules/marketplace/rfqs/rfqs.service.ts:216,220` (primary enqueue `jobId=rfqId`, `removeOnFail age 86400`)
- `src/modules/marketplace/notifications/fanout/rfq-fanout-reconcile.processor.ts:44-54` (re-enqueue same jobId; misleading log at :54)
- `src/config/rfq-fanout.config.ts:15` (`reconcileWindowMs` default 24h — coincides with `removeOnFail` age)

## Proposed Solutions
### Option A — Distinct jobId for reconcile re-drives (Recommended)
- Description: In the reconcile loop, enqueue with a fresh jobId, e.g. `jobId: `${rfqId}:reconcile:${runTs}``
  (pass a timestamp in — `Date.now()` is fine in app code). The code's own comment already states
  "correctness rests on the DB latch + unique index, not on jobId", so a fresh jobId is safe: the CAS latch +
  `ON CONFLICT DO NOTHING` guarantee idempotency even if the original failed job later somehow ran.
- Pros: Minimal; guarantees the re-drive actually executes; no coupling to `removeOnFail` timing.
- Cons: A stuck-forever RFQ would be re-enqueued every tick until it latches (bounded by the 24h window) —
  acceptable, and pairs well with shortening `removeOnFail` (Option C) to keep the failed set small.
- Effort: Small
- Risk: Low

### Option B — Remove the retained job before re-adding
- Description: `await this.fanoutQueue.remove(rfqId)` before the `add` in the reconcile loop, freeing the jobId.
- Pros: Keeps jobId=rfqId (single-slot semantics).
- Cons: A `remove` on an active job is a no-op/edge; extra round-trip per stale RFQ; slightly more fragile.
- Effort: Small
- Risk: Low-Medium

### Option C — Shorten the primary `removeOnFail` well below `reconcileWindowMs`
- Description: Set the producer job's `removeOnFail` to e.g. `{ age: 300 }` (or `true`) so a failed jobId is
  freed minutes after exhaustion — long before the RFQ ages out — letting the same-jobId re-add fire.
- Pros: One-line; keeps jobId=rfqId.
- Cons: Loses the 24h failed-job inspection window for debugging; still relies on the jobId being free at the
  next tick. Best combined with A, not alone.
- Effort: Small
- Risk: Low

**Also (all options):** fix the misleading reconcile log — only log the RFQs actually (re)driven, or note that
`add` may dedup. Consider a metric/alert on RFQs un-latched past the retry horizon (see todo 368 monitoring).

## Recommended Action
Option A (distinct reconcile jobId + fix log) — confirmed by the user. Also added a recency grace so the
distinct jobId doesn't cause redundant re-drives of still-running primary jobs, and extracted the shared
job-options to kill the producer/reconcile duplication (typescript #2 / simplicity #8).

## Resolution (2026-08-21, complete)
- **Distinct reconcile jobId:** `rfq-fanout-reconcile.processor.ts` now enqueues with
  `jobId=`${rfqId}:reconcile:${runTs}`` instead of `jobId=rfqId`, so a retained *failed* primary job can never
  dedup the re-drive to a no-op. The DB latch + `UQ_rfq_notifications_recipient_channel` keep re-drives
  idempotent. Class doc rewritten; the log now reads "re-drove N stalled RFQ(s)" (accurate — every add executes).
- **Recency grace (new):** `findUnfannedSince` gained a `graceMs` UPPER bound → it returns only un-latched RFQs
  in `[now−windowMs, now−graceMs)`. This restores the recency guard the old `jobId=rfqId` dedup was accidentally
  providing, so the reconcile never redundantly re-drives an RFQ whose primary job is still validly running.
  New config `reconcileGraceMs` (default 120000, Joi floor 90000 > the ~62s retry horizon).
- **Shared job-options:** extracted `RFQ_FANOUT_JOB_OPTS` (attempts/backoff/retention, minus jobId) in the
  constants leaf; both the producer (`rfqs.service.ts`) and reconcile spread it, so they can't drift.
- **Files:** `rfq-fanout.config.ts`, `validation-schema.ts`, `constants/rfq-notification.constants.ts`,
  `rfq-repository.interface.ts` + `rfq.repository.ts` (findUnfannedSince grace bound),
  `rfq-fanout-reconcile.processor.ts`, `rfqs.service.ts`.
- **Tests:** updated `rfq-fanout-reconcile.processor.spec.ts` (unique-jobId regex + grace arg); added an
  integration test proving the grace bound skips a just-created un-latched RFQ (graceMs>0) but returns it with
  graceMs:0. Unit 26 / integration 8 green; lint + tsc clean.

## Technical Details
- Affected: reconcile processor, producer enqueue options, rfq-fanout config.
- No migration/schema change. The DB latch + `UQ_rfq_notifications_recipient_channel` already make any number
  of re-drives idempotent, so this is purely a queueing fix.

## Acceptance Criteria
- [ ] A fan-out job that exhausts its retries is re-driven to completion by a subsequent reconcile tick
  (integration/e2e: force the fanout to fail N times, then assert the reconcile eventually latches + creates rows).
- [ ] The reconcile log reflects jobs actually driven, not dedup no-ops.
- [ ] `removeOnFail` and `reconcileWindowMs` no longer share a coinciding 24h horizon (or jobId is distinct).

## Work Log
- 2026-08-21: Filed from PR #47 multi-agent review (data-integrity-guardian, HIGH). Not yet actioned.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
- BullMQ jobId dedup semantics: https://docs.bullmq.io/guide/jobs/job-ids (a retained job keeps the id occupied)
- Plan: docs/plans/2026-08-21-feat-rfq-notification-fanout-plan.md
