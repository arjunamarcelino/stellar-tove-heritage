---
status: complete
priority: p3
issue_id: 327
tags: [code-review, correctness, tov-160]
dependencies: []
---
# `assertClearingInvariants` mirrors the conservation belt but never independently asserts P is the marginal/maximal price

## Problem Statement
`assertClearingInvariants` is described as the "fail-fast belt that mirrors the on-chain guards" — it re-checks the same conservation properties the contract enforces (`Σ allocated == public_float`, `P ∈ band`, each winner `refund ≥ 0`, platform-fee floor, i128 overflow). But the contract (`OfferingEscrow.close_and_settle`) is explicitly a **conservation + no-overcharge belt, NOT a correctness oracle**: it accepts ANY `P ≤ each winner's bid.price`, and it does not verify the winner set is the highest/earliest bids. Producing the *right* winner set and the *maximal* clearing price is `computeClearing`'s job alone. The belt therefore does NOT catch a `computeClearing` regression that produces a too-low P or a sub-optimal winner set — such a result would be contract-valid, would settle, and would **underpay the artist**, with only the unit tests standing between the regression and real money.

## Findings
- `src/modules/offerings/clearing.ts:185-238` — `assertClearingInvariants`. It asserts conservation, band, refund≥0, fee floor, and overflow, but takes only `result` (winners) — it never sees the losing/excluded bids, so it cannot check the two correctness properties.
- `src/modules/offerings/clearing.ts:7-18` + `:138-139` — the module's own doc comments state the contract is a conservation belt and that P ≤ every winner's price "by construction". "By construction" is exactly the property that a `computeClearing` regression would break, and nothing re-asserts it after the walk.
- `src/modules/offerings/settle/offering-settle.processor.ts:129-136` — the settle worker calls `computeClearing` then `assertClearingInvariants` immediately before the real `closeAndSettle` money tx; the belt is the last gate before funds move.

## Proposed Solutions
### Option A — Pass the full sorted book (or the losers) into the belt and assert marginality
- Description: Have `computeClearing` expose (or `assertClearingInvariants` receive) the full sorted book. Assert (a) `min(winner.priceStroops) == P` and (b) `max(loser.priceStroops) <= P` for every EXCLUDED escrowed bid. Optionally also assert winners are a price-sorted prefix of the book.
- Pros: Turns the belt into a genuine correctness oracle for the exact regression class (under-price / wrong-winner-set) that the contract cannot catch; cheap (one pass over the already-in-memory book).
- Cons: Slightly widens the belt's signature/coupling to the sorted input; the marginal partial-fill tie case needs care (equal-price bids straddling the boundary are legitimately split).
- Effort: Small
- Risk: Low

### Option B — Add a self-check inside `computeClearing` instead of the belt
- Description: After Pass 2, assert the same two properties against the local `sorted` array (which `computeClearing` already has) before returning.
- Pros: No signature change to `assertClearingInvariants`; keeps the check adjacent to the code that could regress.
- Cons: A self-check inside the function under test is weaker than an independent belt — a bug in the walk could corrupt both; the belt-at-the-money-boundary placement is lost.
- Effort: Small
- Risk: Low

### Option C — Leave as-is, rely on unit tests
- Description: Accept that unit tests are the sole guard and document the gap.
- Pros: Zero change.
- Cons: Leaves a silent-underpayment regression class guarded only by test coverage; no runtime backstop before the money tx.
- Effort: None
- Risk: Medium (money correctness has no runtime backstop)

## Recommended Action
Option A — pass the sorted book (or the excluded set) into `assertClearingInvariants` and assert `min(winnerPrice) == P` and `max(loserPrice) <= P`. This makes the pre-money belt catch the one regression class the on-chain guards structurally cannot, at negligible cost.

## Technical Details
The marginal partial-fill invariant is subtle: multiple bids at exactly P may straddle the float boundary, so the correct assertions are `min over winners of price == P` and `every non-winner price <= P` (NOT strict `<`), consistent with the `(price DESC, createdAt ASC, id ASC)` sort in `computeClearing` (`clearing.ts:91-98`). Keep everything BigInt.

## Acceptance Criteria
- `assertClearingInvariants` (or an equivalent pre-money assertion) throws `RangeError` when P is below the marginal winning price, or when any excluded escrowed bid has `price > P`.
- A unit test injects a deliberately-too-low P / a wrong-winner-set result and asserts the belt rejects it before any escrow call.
- The correct marginal partial-fill case (equal-price bids straddling the float boundary) still passes.

## Work Log
- 2026-08-20: created from PR #43 security-sentinel review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Added an independent uniform-price OPTIMALITY belt to `assertClearingInvariants` (using `result.winners` +
`result.bidsSnapshot`, no signature change): (1) the clearing price P must equal the marginal (minimum)
winning price, and (2) every losing bid (in the snapshot, not in the winner set) must be priced ≤ P. These
catch a `computeClearing` regression that produced a too-low P or a suboptimal winner set — which the on-chain
conservation belt would accept as contract-valid while underpaying the artist. Added clearing.spec case #327
(a loser priced above P → RangeError). Build green; clearing spec 18/18.
