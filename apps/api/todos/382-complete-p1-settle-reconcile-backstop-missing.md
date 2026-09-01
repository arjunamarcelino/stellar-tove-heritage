---
status: complete
priority: p1
issue_id: 382
tags: [code-review, tov-177, pr-49, reliability, data-integrity, money-path, bullmq]
dependencies: []
---
# Missing settle reconcile backstop → a stranded `pending` trade permanently wedges the RFQ

## Problem Statement
The settle worker ships **without its reconcile scheduler/processor**, yet the design's money-safety story
leans on that backstop in comments, config, an index, and a repo method. A crash (or Redis blip, or
retry-exhaustion) in the commit→enqueue window strands a `secondary_trades` row at `status='pending'`. Because
that row *is* the double-accept latch (`UQ_secondary_trades_pending (rfq_id) WHERE status='pending'`), the RFQ
becomes **permanently un-acceptable and un-fillable** with no automatic recovery — the seller's fractions stay
locked (the quote remains `open`+authorized, so `sumAuthorizedLockedCount` keeps counting it) and the buyer's
poll reports `pending` forever. If a settle tx actually landed on-chain, the DB never reflects it.

**Corroboration: flagged independently by 6 of 7 review agents** (data-integrity P1, security P2-2,
architecture P2, typescript P2, performance P2, simplicity P2). Escalated to **P1** for the concrete
liveness/corruption path on a money endpoint.

## Findings
Dead scaffolding that presupposes a backstop which does not exist:
- `src/modules/marketplace/settlement/accept/accept.service.ts:195` — comment claims *"the reconcile backstop
  re-drives a lost enqueue"* (false). The enqueue at `:199` is best-effort; the catch at `:206-208` only logs.
- `src/config/marketplace-settlement.config.ts:28-33` — `settleGraceMs`, `reconcileEnabled`, `reconcileCron`,
  `reconcileGraceMs`, `reconcileBatch` — described as *"consumed by the deferred settle/reconcile worker"*;
  nothing consumes them.
- `src/modules/marketplace/settlement/repositories/secondary-trade.repository.ts:108` `findStalePending` +
  `secondary-trade-repository.interface.ts:60` — no production caller (grep: only the interface, impl, and one
  integration test).
- `src/database/migrations/1716000000045-...ts:143-146` — `IDX_secondary_trades_stale` exists only to serve that
  unused query.
- `src/modules/marketplace/settlement/settle/quote-settle-worker.module.ts:16-19` — labels the reconcile a
  "documented follow-up".

Trigger paths that strand: (a) `settleQueue.add` throws (Redis unavailable) → swallowed; (b) process crash
between commit (`accept.service.ts:155`) and enqueue (`:199`); (c) BullMQ exhausts `attempts:8` then
`removeOnFail:{age:900}` drops the job during an extended RPC outage; (d) an unmapped/deterministic `REVERTED`
retries forever until attempts exhaust (see [[383-pending-p1-settle-classifier-misattribution]]).

## Proposed Solutions
### Option A — Ship the reconcile scheduler/processor (Recommended)
- Add a `settle/quote-reconcile.{scheduler,processor}.ts` (mirror `offerings/settle` +
  `fractionalization` + `rfq-fanout` reconcile workers) that periodically drives `findStalePending(graceMs,
  batch)` → for each: `isSettled` ? adopt (`persist(trade, null)`) : re-enqueue; plus a terminal-timeout that
  fails a trade stuck far past grace so the latch frees.
- The repo method, `IDX_secondary_trades_stale`, and the config knobs are already in place.
- Pros: matches every sibling async money-worker; delivers the guarantee the comments already claim.
  Cons: more surface to test. Effort: Medium · Risk: Low.

### Option B — Remove the dead scaffolding + soften the durability comment
- Delete `findStalePending` (+ interface + integration test), the five reconcile config knobs, and
  `IDX_secondary_trades_stale`; rewrite `accept.service.ts:194-195` to stop claiming a backstop exists; add an
  alert/metric on enqueue failure so a lost job is at least observable.
- Pros: honest, ~40-60 LOC + one index + one test removed. Cons: leaves the wedge liveness risk unmitigated —
  only acceptable if accept volume stays tiny and ops watches the metric. Effort: Small · Risk: Medium (the
  underlying strand risk remains).

## Recommended Action
Option A before this sees real accept volume. It is the floor that several other findings (384, 383) rely on.
Until it lands, at minimum do Option B's alerting so a stranded RFQ is detectable.

## Technical Details
- Affected: `settle/` (new reconcile worker), `accept.service.ts` (comment), `secondary-trade.repository.ts`,
  `marketplace-settlement.config.ts`, migration 045 (`IDX_secondary_trades_stale`).
- Fails **closed** today (no double-settle) — the risk is liveness/strand, not fund loss.

## Acceptance Criteria
- [ ] A stranded `pending` trade (simulate: enqueue lost) is auto-recovered (adopted or re-enqueued) within grace.
- [ ] A trade whose tx truly landed is adopted (`settled`, RFQ `filled`) by the reconciler.
- [ ] A trade past terminal-timeout with `is_settled==false` frees the latch so the RFQ can be re-accepted.
- [ ] No code/comment/config references a backstop that isn't wired.

## Resolution (2026-08-22, complete — Option A: built the reconcile worker)
Shipped the lost-enqueue / retry-exhausted backstop, matching every sibling async money-worker:
- **`SettlePersistenceService`** (new) — the atomic `persistSettled` (trade→settled + rfq→filled +
  quote→accepted + rivals→superseded + audit, ONE txn) and `failTrade` (trade→failed + optional quote-expire +
  audit), extracted from the processor so BOTH the main processor and the reconcile share one implementation of
  the money-safe transitions.
- **`QuoteSettleReconcileScheduler`** — repeatable job on boot, gated on `reconcileEnabled`, cron
  `reconcileCron` (mirrors the offering settle reconcile scheduler).
- **`QuoteSettleReconcileProcessor`** (`concurrency:1`) — drives `findStalePending(reconcileGraceMs,
  reconcileBatch)`; per row: `is_settled==true` → **adopt** (`persistSettled`, idempotent, safe at any age);
  else past the BullMQ retry horizon (`max(reconcileGraceMs, ~700s)`, so no live job can still land) → **abandon**
  (`failTrade` reason `settle_abandoned`, keepOpen — frees the pending latch so the buyer can re-accept). A
  young-but-stale trade within the horizon is left for its live job. It CANNOT re-enqueue a fresh settle — the
  buyer passkey assertion + auth entries are job-only bearer material (never persisted, by design) — so the
  contract is adopt-or-abandon, not re-drive.
- Wired the scheduler + processor + `SettlePersistenceService` + the reconcile queue into
  `QuoteSettleWorkerModule`. The `findStalePending` method, `IDX_secondary_trades_stale`, and the reconcile
  config knobs (previously dead scaffolding) are now consumed. New reason `settle_abandoned`.

Verified: build 0, lint clean, new reconcile integration 3/3 (adopt → settled+filled+superseded; abandon →
failed(settle_abandoned)+rfq/quote stay open; within-horizon → left pending), accept e2e 4/4 unchanged (the
processor refactor to delegate to `SettlePersistenceService` is behavior-preserving).

### Files
- NEW `settle/settle-persistence.service.ts`, `settle/quote-settle-reconcile.scheduler.ts`,
  `settle/quote-settle-reconcile.processor.ts`, `test/integration/.../quote-settle-reconcile.integration.spec.ts`
- `settle/quote-settle.job.ts` (+`QUOTE_SETTLE_RECONCILE_QUEUE`), `settle/quote-settle.processor.ts` (delegate),
  `settle/quote-settle-worker.module.ts` (wire), `settle/settle-failure.constant.ts` (+`settle_abandoned`)

## Work Log
- 2026-08-22: Filed from PR #49 multi-agent review (6/7 agents).
- 2026-08-22: Built the reconcile worker (Option A) + extracted the shared persistence service; tests green; complete.
