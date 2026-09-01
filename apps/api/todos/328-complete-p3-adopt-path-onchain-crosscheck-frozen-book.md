---
status: complete
priority: p3
issue_id: 328
tags: [code-review, correctness, tov-160]
dependencies: []
---
# Self-heal adopt path recomputes clearing from the DB book instead of reading the on-chain settled allocations

## Problem Statement
On the settle worker's self-heal adopt path (`readStatus() === 'settled'` → `adopted = true`), the offering has ALREADY been settled on-chain, so the authoritative allocation map + clearing price live in the escrow contract. But the worker does NOT read them — it re-runs `computeClearing` from `listBidsForClearing` and persists THAT recompute as the authoritative `offering_clearing_audit` snapshot and the won/lost bid flip. This is correct **today** only because the escrowed book is provably frozen once the offering is subscribed (both `submit_bid` and `cancel_bid` require `status === 'opened'`) and `computeClearing` is deterministic, so the recompute must equal what the contract settled. That safety rests on an invariant held **elsewhere** (the bid state machine), not on any assertion at the adopt site. Any future FR that mutates the escrowed set while `subscribed` — admin bid removal, a soft-delete, a cancel-during-settle — would silently diverge the DB receipts (audit snapshot, refund amounts, won/lost flags) from the actual on-chain money movement, with no error raised. This is the plan's R1/F7 real-adapter gate.

## Findings
- `src/modules/offerings/settle/offering-settle.processor.ts:106` — `let adopted = status === 'settled';` sets the adopt path.
- `src/modules/offerings/settle/offering-settle.processor.ts:127-136` — `listBidsForClearing` + `computeClearing` + `assertClearingInvariants` run on BOTH paths; on the adopt path this recompute is never cross-checked against the chain.
- `src/modules/offerings/settle/offering-settle.processor.ts:158` + `:199-212` — `persist(...)` writes the recomputed `clearingPriceStroops`, `bidsSnapshot`, `allocationMap`, and per-winner `refundStroops` as the authoritative audit snapshot, and flips bids won/lost — none of it read back from the escrow.
- `src/modules/offerings/settle/offering-settle.processor.ts:127` — the `listBidsForClearing` read is issued OUTSIDE the settle txn (out-of-txn read site), so even the frozen-book assumption is not transactionally pinned.
- Frozen-book basis (not asserted here): `submit_bid`/`cancel_bid` both gate on `status === 'opened'` (see `bids/` and `bids/cancel/` surfaces), so once `opened → subscribed` latches, the escrowed set cannot change.

## Proposed Solutions
### Option A — Read + diff the on-chain settlement on the adopt path
- Description: When `adopted`, read the escrow's actual `clearing_price` + `allocation_map` and diff against the recompute; on any mismatch, fail terminal (stamp `OFFERING_SETTLE_FAILED`, do NOT persist divergent receipts).
- Pros: Makes the DB receipts provably equal to on-chain money even if the book invariant is ever broken; closes R1/F7 with a hard runtime gate.
- Cons: Requires an escrow read port for the settled allocation map (may not exist yet — a real-adapter task); adds an RPC read on the adopt path.
- Effort: Medium
- Risk: Low

### Option B — Assert the frozen-book invariant + document the dependency
- Description: Keep the recompute, but add an explicit assertion/comment at the adopt site (and at the out-of-txn `listBidsForClearing` read) documenting that correctness depends on the escrowed set being frozen once `subscribed`, and cite the `submit_bid`/`cancel_bid` `opened`-only gates. Optionally assert no bid rows changed `updated_at` after the subscribe latch.
- Pros: Cheap; encodes the load-bearing invariant so a future FR that breaks it trips the assertion / is caught in review.
- Cons: Still trusts the recompute rather than the chain; a soft-delete that bypasses the assertion could still slip.
- Effort: Small
- Risk: Medium

### Option C — Defer to the real-adapter gate, leave a tracked note
- Description: Accept the current recompute for the fake-adapter phase; track the on-chain cross-check as the explicit R1/F7 real-adapter acceptance gate.
- Pros: No churn during the fake-adapter phase.
- Cons: Ships an adopt path whose correctness is undocumented at the call site.
- Effort: None
- Risk: Medium

## Recommended Action
At minimum Option B now (assert + document the frozen-book dependency at the adopt site and the out-of-txn read), and schedule Option A as the R1/F7 real-adapter gate so the adopt path diffs the recompute against the on-chain `allocation_map`/`clearing_price` and fails terminal on mismatch.

## Technical Details
The two read sites to annotate: `listBidsForClearing` at `offering-settle.processor.ts:127` (out-of-txn) and the `adopted` branch decision at `:106`. The diff in Option A should compare `result.clearingPriceStroops` and `toAllocationMap(result)` (`clearing.ts:172-175`) against the chain's settled values; a mismatch is a terminal, non-retryable settle failure (never persist divergent won/lost flags).

## Acceptance Criteria
- The adopt path either (A) reads and diffs the on-chain settled allocation map + clearing price and fails terminal on mismatch, or (B) carries an explicit invariant assertion + comment documenting the frozen-book dependency at both the adopt-decision site and the out-of-txn `listBidsForClearing` read.
- A test simulates a divergence between the recompute and the "settled" chain state and asserts the worker does NOT persist divergent receipts.

## Work Log
- 2026-08-20: created from PR #43 security-sentinel + data-integrity-guardian review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Documented the load-bearing FROZEN-BOOK invariant at the clearing recompute site: the adopt-path recompute is
authoritative only because the escrowed set cannot change once `subscribed` (submit + cancel both require
`opened`) and `computeClearing` is deterministic, so recompute == what settled on-chain. Added an explicit
comment stating that if any future FR mutates the escrowed set while `subscribed`, the adopt path MUST switch
to reconstructing P/allocations from the on-chain `OfferingSettled` event + `bid()` reads and diffing them.
The full on-chain cross-check / reconstruct-from-event is the plan's real-adapter merge gate (F7/R1, chain-gated
with `bind_token`), so it is intentionally NOT implemented in this Fake-proven release — the comment makes the
dependency explicit and points at the gate. No behavior change. Build green.
