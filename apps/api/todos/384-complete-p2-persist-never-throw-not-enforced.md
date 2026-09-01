---
status: complete
priority: p2
issue_id: 384
tags: [code-review, tov-177, pr-49, money-path, data-integrity, transactions]
dependencies: [382]
---
# `persist()` "never throw after chain-confirm" invariant is asserted but not enforced

## Problem Statement
`QuoteSettleProcessor.persist()` runs, in ONE transaction: `casSettled` (the authoritative flip) then the
"best-effort" `casFilled` / `casAccepted` / `supersedeOpenRivals` and `audit.record` — **with no try/catch**.
The inline comment claims these must never throw *"or a confirmed on-chain settlement would roll back into a
permanent DB-pending strand"*, but nothing prevents a throw. A transient DB error / deadlock / connection drop
on any sub-step rolls back the **entire** transaction, including the `settled` flip — leaving the trade
`pending` while funds have already moved on-chain. The mitigation (retry + `is_settled` adopt) is exactly the
retry path that [[382-pending-p1-settle-reconcile-backstop-missing]] leaves without a floor, so a persistent
transient or retry-exhaust strands a money-bearing trade.

## Findings
- `src/modules/marketplace/settlement/settle/quote-settle.processor.ts:97-116` — `runInTransaction` body; the
  sub-CAS + `audit.record` at `:103-115` have no error isolation; comment at `:101-102` asserts the invariant.
- Note the CAS methods themselves return `affected:0` (don't throw) on a lost race — so the realistic trigger is
  a **transient infra error** (deadlock/connection) or an `audit.record` failure, not a business-rule miss.
- data-integrity verified `audit.record` cannot *deterministically* fail here (free `varchar(64)` kind,
  `actor_type='system'` satisfies the CHECK, uuid subject) — the exposure is transient only. (Security's pass
  read this as "clean" assuming only the CAS sub-steps; the gap is the un-isolated transient throw + audit.)

## Proposed Solutions
### Option A — Isolate the post-confirm sub-steps so the `settled` flip cannot roll back (Recommended)
- Commit `casSettled` in its own transaction, then run the best-effort `casFilled`/`casAccepted`/
  `supersedeOpenRivals`/audit in a second transaction wrapped in try/catch that swallows+logs. A failure there
  leaves the trade correctly `settled` (money truth preserved) with at most a lagging rfq/quote status that the
  reconciler (382) or a later adopt run repairs.
- Pros: makes the asserted invariant real. Cons: two txns instead of one; the rfq/quote flip can briefly lag.
  Effort: Small · Risk: Low.

### Option B — Keep one txn but try/catch the sub-steps
- Wrap only the sub-CAS + audit in try/catch inside the same txn. NOTE: this does **not** fully fix it — a
  swallowed error still leaves the txn in a failed/aborted state in Postgres, so the `settled` flip can still
  roll back. Only acceptable if the driver + TypeORM semantics guarantee the outer statement already committed,
  which they do not within a single `runInTransaction`. Prefer A.
- Effort: Small · Risk: Medium (may not actually fix the rollback).

## Recommended Action
Option A — separate the authoritative `casSettled` commit from the best-effort downstream updates.

## Technical Details
- Affected: `quote-settle.processor.ts` (`persist`), possibly `secondary-trade.repository.ts` (a
  commit-then-followup helper). Interacts with 382 (reconcile is the ultimate floor).

## Acceptance Criteria
- [ ] A forced throw in `casFilled`/`audit.record` after a winning `casSettled` leaves the trade `settled`
      (not rolled back to `pending`).
- [ ] rfq/quote status lag (if any) is self-healed on a subsequent adopt/reconcile pass.

## Resolution (2026-08-22, complete — DEVIATION from Option A; atomic + reconcile floor instead)
**Option A (split the `casSettled` commit from the downstream sub-steps) was REJECTED as unsafe.** Investigation
found `AcceptService.resolveContext` gates a buyer accept on `rfq.status === 'open'` (`accept.service.ts:226`,
`ACCEPT_RFQ_NOT_OPEN`). If `persist()` committed the trade→settled flip but a lagging second txn left the RFQ
`open`, a concurrent second accept could slip past that gate and **double-settle the same RFQ** (a real
money-safety regression, worse than the strand it was meant to fix). So the `{trade→settled, rfq→filled,
quote→accepted, rivals→superseded, audit}` block MUST stay atomic.

Resolution instead: keep `persist()` (now `SettlePersistenceService.persistSettled`, shipped under #382) as ONE
atomic txn, and make the asserted invariant TRUE by relying on the reconcile FLOOR built in
[[382-complete-p1-settle-reconcile-backstop-missing]]: a transient throw correctly rolls the whole txn back to
`pending` (no partial state, no double-settle window), and the reconcile sweep then re-drives it — adopting if
`is_settled`, else abandoning past the retry horizon. The strand the finding worried about ("the retry path #382
leaves without a floor") is closed precisely because #382 now provides that floor.

Concrete changes here:
- The atomicity rationale (why the block is deliberately one txn — the double-settle window) is documented on
  `SettlePersistenceService.persistSettled` (shipped with #382).
- Corrected the misleading `accept.service.ts` comment that claimed a backstop "re-drives a lost enqueue" — it
  now accurately describes the reconcile's adopt-or-abandon contract (and that it cannot re-drive, since the
  buyer assertion is job-only bearer material).

Verified: build 0, lint clean. Behavior covered by accept e2e AC1/AC2 (atomic happy + seller-fault) and the
#382 reconcile integration (adopt / abandon on a stranded pending trade).

### Files changed (this issue)
- `src/modules/marketplace/settlement/accept/accept.service.ts` (comment accuracy)
- (atomicity comment + shared atomic persist live in `settle/settle-persistence.service.ts`, shipped under #382)

## Work Log
- 2026-08-22: Filed from PR #49 review (data-integrity P2).
- 2026-08-22: Option A found unsafe (double-settle window); resolved via atomic-persist + the #382 reconcile
  floor; comment corrected; marked complete.
