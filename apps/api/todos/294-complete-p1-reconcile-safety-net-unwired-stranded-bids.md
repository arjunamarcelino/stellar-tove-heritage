---
status: complete
priority: p1
issue_id: 294
tags: [code-review, money, reliability, yagni]
dependencies: []
---

# Reconcile safety-net is referenced everywhere but not wired — stranded 'submitted' bids have no recovery; dead scaffolding

## Problem Statement
The code, config, repository method, and queue constant for a bid reconcile sweep all exist, and `submit()` even logs "reconcile will re-drive" on enqueue failure — but NO bid reconcile processor or scheduler actually exists. Stranded `submitted` bids (enqueue failure after commit; crash after on-chain success before `casEscrowed`) therefore have NO automated recovery and permanently occupy the collector's one active-bid slot (every retry → 409 `BID_ALREADY_ACTIVE`). Worse, the unused knobs make the gap LOOK covered on a money surface where it is not.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:210` — logs "reconcile will re-drive" on enqueue failure, but nothing re-drives; the promise is false.
- `src/modules/offerings/bids/offering-bids.constants.ts:7` — `OFFERING_BID_RECONCILE_QUEUE` is declared but never registered or consumed.
- `src/config/offering-bid.config.ts:11-17` + `src/config/validation-schema.ts:157-164` — `reconcileEnabled` / `reconcileCron` / `reconcileBatch` + `submittedGraceMs` are defined and validated but unused; only `maxBidCostStroops` is actually read.
- `src/modules/offerings/repositories/offering-bid.repository.ts:98-110` (+ interface `:47-51`) — `findStaleSubmitted` has no production caller (only an integration test references it).
- Contrast the deploy sibling `src/modules/offerings/deploy/offering-worker.module.ts`, which ships a real `OfferingReconcileProcessor` + `OfferingReconcileScheduler`.
- Processor JSDoc `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts:22-27` explicitly defers ONLY the crash-after-on-chain-success reconciler; the enqueue-failure window has NO backstop at all.
- Failure scenario: enqueue fails after the DB commit (or the process crashes after the escrow tx lands but before `casEscrowed`). The row sits `submitted` forever, holding the `UQ_offering_bids_active_per_collector` slot; the collector's every retry returns 409 `BID_ALREADY_ACTIVE` with no path to recovery.

## Proposed Solutions
### Option A: Ship the stale-`submitted` reconcile scheduler + processor (chain-querying)
- **Description:** Mirror the deploy path with a repeatable cron scheduler + processor over `findStaleSubmitted`. Per the processor JSDoc it MUST query chain state (adopt-as-escrowed on the contract's `DuplicateBid` / emitted bid id) rather than blind re-submit — a blind re-drive of a landed bid → `DuplicateBid` → `transfer_failed` → wrongly `casFailed` (i.e. finding 293's pattern). At minimum ship a re-enqueue-only sweep for the enqueue-failed rows where nothing landed on-chain.
- **Pros:** Real automated recovery; frees stuck slots; matches the deploy sibling. **Cons:** Requires a reliable chain-state query + adopt path to be safe; needs live-testnet validation. **Effort:** Medium/Large **Risk:** Med

### Option B: Delete the dead scaffolding + document manual posture
- **Description:** If the chain-querying reconciler can't ship now, remove the queue constant, `findStaleSubmitted`, the 4 unused config knobs, and their Joi entries; fix the misleading "reconcile will re-drive" comment; DOCUMENT that stuck bids are manual-recovery-only; and add a stuck-`submitted` monitoring alert.
- **Pros:** Removes the false safety signal (YAGNI); honest about the operational posture; small. **Cons:** No automated recovery — stuck bids still need a human + alert. **Effort:** Small **Risk:** Low

### Option C: Hybrid — safe re-drive now, defer chain-adopt
- **Description:** Ship the safe enqueue-failed re-drive sweep now (only rows where nothing landed on-chain), defer the chain-state adopt reconciler, and keep only the config the shipped sweep actually uses.
- **Pros:** Recovers the common (enqueue-failure) case without the risky blind re-submit; trims unused config. **Cons:** The crash-after-success window still needs the deferred chain-adopt path + an alert. **Effort:** Medium **Risk:** Med

## Recommended Action
<!-- filled during triage -->

## Technical Details
- `src/modules/offerings/bids/offering-bids.service.ts` (misleading log at :210)
- `src/modules/offerings/bids/offering-bids.constants.ts` (`OFFERING_BID_RECONCILE_QUEUE`)
- `src/config/offering-bid.config.ts` + `src/config/validation-schema.ts` (unused knobs)
- `src/modules/offerings/repositories/offering-bid.repository.ts` (+ interface) (`findStaleSubmitted`)
- `src/modules/offerings/deploy/offering-worker.module.ts` (reference implementation)
- `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts` (JSDoc :22-27)

## Acceptance Criteria
- [ ] EITHER a bid reconcile worker exists and an integration test proves a stale `submitted` row is recovered (escrowed) or failed after the grace window, OR
- [ ] the dead scaffolding (queue const, `findStaleSubmitted`, 4 config knobs + Joi entries) is removed and the manual-recovery posture + monitoring alert are documented.
- [ ] The "reconcile will re-drive" comment no longer overstates the safety net (either it becomes true, or it is corrected).
- [ ] A stuck-`submitted` monitoring/alerting hook is in place if automated recovery is not shipped.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41
- src/modules/offerings/bids/offering-bids.service.ts
- src/modules/offerings/bids/offering-bids.constants.ts
- src/config/offering-bid.config.ts
- src/config/validation-schema.ts
- src/modules/offerings/repositories/offering-bid.repository.ts
- src/modules/offerings/deploy/offering-worker.module.ts

---

## Resolution (COMPLETE — 2026-08-20)

**Chosen:** Option B — remove the dead scaffolding + document the manual-recovery posture (confirmed with
the maintainer). The safe DB↔chain reconciler (adopt-as-escrowed on the contract's `DuplicateBid`) remains a
live-testnet-gated follow-up in its own ticket; it pairs with the money-safe classification in **todo 293**
(a stranded `submitted` bid is never wrongly failed, so no funds are lost).

**Removed (dead code):**
- `OFFERING_BID_RECONCILE_QUEUE` (`offering-bids.constants.ts`) — never registered/consumed.
- `reconcileEnabled/Cron/Batch` + `submittedGraceMs` (`offering-bid.config.ts`) + their Joi entries
  (`validation-schema.ts`) — only `maxBidCostStroops` is used.
- `findStaleSubmitted` (`offering-bid-repository.interface.ts` + `offering-bid.repository.ts`) — no caller.
- `IDX_offering_bids_stale_submitted` (migration `1716000000036`, up + down) — read by nothing (dropped
  from `tove_test`; not yet on shared DBs).

**Documented:** the `constants.ts` header, the processor NOTE, and the `submit()` enqueue-failure log now
state there is no reconciler and stranded bids are resolved manually via the stuck-bid monitoring alert
(the runbook lives in **todo 302**). The misleading "reconcile will re-drive" log was corrected.

**Tests:** removed the `findStaleSubmitted` integration test + the stale-index drift-guard; integration
10/10, e2e 7/7, build + lint green.
