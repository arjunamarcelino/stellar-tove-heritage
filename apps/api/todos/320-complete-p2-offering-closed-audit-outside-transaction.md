---
status: complete
priority: p2
issue_id: 320
tags: [code-review, reliability, tov-160]
dependencies: []
---
# `OFFERING_CLOSED` audit write runs outside the settle transaction and can terminalize a completed close

## Problem Statement
In the settle processor, the `OFFERING_CLOSED` audit (`await this.audit.record(...)` after `closeOffering` lands) is the **one** happy-path DB write done **outside** `runInTransaction`, and it runs **after** `close_offering` has already landed on-chain. If `audit.record` throws a transient error, the outer catch classifies it terminal, stamps `settle_failed`, and the row is excluded from `findStaleSubscribed` auto-reconcile — forcing a manual admin re-drive. (Re-drive does recover via `readStatus` adoption, but the automatic self-heal is forfeited.) The deploy processor deliberately keeps **all** audit writes inside the success transaction to avoid exactly this failure mode.

## Findings
- `src/modules/offerings/settle/offering-settle.processor.ts` — the `OFFERING_CLOSED` audit `await this.audit.record(...)` is placed after `closeOffering` lands and **outside** `runInTransaction`; it is the only happy-path DB write not covered by the transaction.
- Outer catch — any throw (including a transient `audit.record` failure) is classified terminal and stamps `settle_failed`.
- `findStaleSubscribed` excludes `settle_failed_at IS NOT NULL`, so a terminalized-but-actually-closed row drops out of auto-reconcile.
- **Precedent:** the deploy processor keeps all audit writes inside the success transaction specifically to prevent a transient audit failure from terminalizing completed work.
- Related: finding 321 (the settle classifier defaults non-domain errors to terminal, which is what turns this transient audit failure into a terminal stamp).

## Proposed Solutions
### Option A — Make the `OFFERING_CLOSED` audit best-effort
- Description: Wrap the post-close audit in `.catch(warn)` so a transient failure logs a warning but cannot terminalize an offering whose `close_offering` has already landed.
- Pros: Minimal change; guarantees a landed close is never terminalized by an audit hiccup.
- Cons: A dropped audit row is a (logged) observability gap; the audit is no longer guaranteed durable.
- Effort: Small
- Risk: Low

### Option B — Move the audit into a transaction
- Description: Perform the `OFFERING_CLOSED` audit inside a `runInTransaction` block (mirroring the deploy processor) so a transient failure rolls back cleanly and is retried rather than terminalizing the row.
- Pros: Keeps the audit durable and consistent with the deploy precedent; a transient failure becomes retryable, not terminal.
- Cons: Requires care around ordering relative to the already-landed on-chain close (the txn must be safe to retry after close has landed).
- Effort: Small
- Risk: Low

## Recommended Action
Option B — move the `OFFERING_CLOSED` audit into a transaction so a transient failure can't terminalize a completed close, matching the deploy processor precedent and keeping the audit durable. If retry-after-landed-close ordering proves awkward, fall back to Option A (best-effort `.catch(warn)`), which still prevents the terminalization. Coordinate with finding 321, which changes how such transient errors are classified.

## Technical Details
The offering row's settle lifecycle keys auto-reconcile on `subscribed AND settle_failed_at IS NULL`. Any terminal stamp after the on-chain close has landed removes the row from the self-healing set even though the money-moving step succeeded. Keeping the post-close audit either transactional-and-retryable (Option B) or non-fatal (Option A) preserves the auto-heal path.

## Acceptance Criteria
- A transient `audit.record` failure after `close_offering` lands does **not** stamp `settle_failed` and does not remove the row from `findStaleSubscribed` auto-reconcile.
- Happy-path audit behavior is otherwise unchanged (`OFFERING_CLOSED` still recorded on success).
- Behavior is consistent with the deploy processor's all-audits-in-txn precedent.

## Work Log
- 2026-08-20: created from PR #43 [pattern-recognition-specialist] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Made the OFFERING_CLOSED audit write (in `recordClosed()`, after `close_offering` lands and outside the
persist txn) BEST-EFFORT via `.catch(warn)`. A transient `audit.record` failure there can no longer bubble
into the terminal-classification catch — which would have stamped `settle_failed_at` on a successfully-closed
offering and excluded it from the `findStaleSubscribed` auto-reconcile, forcing a manual re-drive. The close
is durable on-chain and re-observed by the next attempt's self-heal `readStatus`, so a missed audit row is a
cosmetic timeline gap, not a state-integrity or fund issue. Build green.
