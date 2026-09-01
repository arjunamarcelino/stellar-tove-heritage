---
status: complete
priority: p3
issue_id: 342
tags: [code-review, testing, quality, tov-162]
dependencies: []
---
# clearing.spec test consolidation + minor test nits (PR #44)

## Problem Statement
The TOV-162 test additions are strong (hand-checked golden vectors, a 300-iter fuzz property test, belt-rejection cases), but a few vectors overlap and two small idioms could be tightened. Money-path over-coverage is defensible, so these are p3 optional consolidations — the point is to record the overlap consciously, not necessarily to delete.

## Findings
Sources: code-simplicity-reviewer, kieran-typescript-reviewer, pattern-recognition-specialist (PR #44 review). Files: `test/unit/modules/offerings/clearing.spec.ts`, `test/e2e/offering-settlement.e2e-spec.ts`.

- **(F7, p3) B4 duplicates PR4's belt assertion.** B4 (`clearing.spec.ts` belt block) and PR4 (walk block, ~`:180` region) call the identical `computeClearing([bid(1,100,3,1),bid(2,100,3,2),bid(3,100,1,3)], 4n)` then the identical `assertClearingInvariants(...).not.toThrow()`. B4 adds no coverage over PR4. PR4 already owns the winners-shape assertion → B4 is the removable one (or keep both if you want the belt block self-contained).
- **(F8, p3) PR1 and PR8 overlap** — both are all-`@P`, dust-0, clean-proportional splits (PR1 `[250,150,100]`→`[100,60,40]`; PR8 `[500,300,200]`→`[450,270,180]`). Same code path/property. PR8's "above tier empty" framing is already true of PR1. One suffices for the dust-0 case.
- **(F9, p3) U6′ and PR2 overlap** on "dust 1 → +1 to earliest" (U6′ equal-count, PR2 unequal-count/more general). Keep PR2 for coverage; U6′ earns its place as the **behavior-change regression** ("was time-priority [400,400,200]") rather than added algorithmic coverage — worth a one-line comment saying so.
- **(TS, p3) PR5 uses a `!` non-null assertion** — `const w1 = r.winners.find(w => w.chainBidId === 1)!;`. Pragmatically fine in a test, but `expect(w1).toBeDefined()` before deref (or the array-map form the other tests use) is the stricter idiom.
- **(TS, p3) PR-FUZZ boolean matchers** — `expect(BigInt(x) > 0n).toBe(true)` reports only `expected true, got false` with no operand values on failure. A custom message or split comparison would speed triage if the fuzz ever flakes.
- **(pattern, p3) Test-naming deviation** — the new `PR1…PR12`/`PR-FUZZ` and `B1…B5`/`E-PR1/2` prefixes deviate from the file's existing conventions (walk block = `U`-sequence; belt block = descriptive/`#`-tagged names like "#327 rejects…"). Defensible as a coherent feature cluster, but it is a scheme deviation. Either fold into the `U`-sequence + descriptive belt names, or leave and accept the grouped-by-feature readability.

## Proposed Solutions
### Option A — Consolidate the two clear duplicates, tighten the two idioms, leave naming
- Description: Drop B4 (covered by PR4) and one of PR1/PR8; add the "regression vs time-priority" comment to U6′; replace PR5's `!` with a `toBeDefined()` guard; leave PR/B naming as a deliberate cluster (note it in the file header).
- Pros: Removes true duplicate coverage; clearer failure output.
- Cons: Slightly fewer explicit belt-block tests (B4 removal).
- Effort: Small
- Risk: Low

### Option B — Keep all tests, document overlaps only
- Description: Leave the suite as-is (money-path over-coverage is cheap insurance); this todo records the overlap.
- Pros: Maximum coverage retained; zero churn.
- Cons: Minor duplicate maintenance.
- Effort: None
- Risk: None

## Recommended Action
Option A but conservative: tighten the two idioms (PR5 `!`, U6′ comment) and pick ONE of {drop B4} vs {keep} based on whether the belt block should stay self-contained — recommend keeping B4 (self-contained belt block is worth the 3 lines) and dropping the PR1/PR8 duplicate instead. Naming: leave as a deliberate cluster.

## Technical Details
- Affected files: `test/unit/modules/offerings/clearing.spec.ts`, `test/e2e/offering-settlement.e2e-spec.ts`. No src change.
- U10′ (`:125`) and B2 (`:330`) share an input but assert opposite sides (production tiebreak vs belt-rejects-reshuffle) — **NOT redundant, keep both** (confirmed by simplicity review F10).

## Acceptance Criteria
- No two unit tests assert the identical input + identical expectation (either B4 or the PR1/PR8 pair consolidated).
- U6′ carries a comment noting it is the time-priority→pro-rata regression.
- `yarn test` green.

## Work Log
- 2026-08-21: created from PR #44 review (simplicity + typescript + pattern). Findings-only; not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/44
- Tests: `test/unit/modules/offerings/clearing.spec.ts`

---

## Resolution (COMPLETE — 2026-08-21)
User-confirmed "Drop PR8, keep B4". Applied to `test/unit/modules/offerings/clearing.spec.ts`:
- **Dropped PR8** — its all-`@P`, dust-0, proportional-split case (`[500,300,200]→[450,270,180]`) is already covered by PR1 (`[250,150,100]→[100,60,40]`). Left a one-line breadcrumb comment where it was.
- **Kept B4** — the belt describe-block stays self-contained (B4 asserts the belt accepts a zero-alloc `==P` loser; PR4 asserts the winners shape — kept both).
- **Tightened PR5** — replaced the non-null-asserted `r.winners.find(...)!` with the array-`map` form the other tests use (asserts `[chainBidId, allocatedCount, refundStroops]` for all three winners); no `!` remains in PR5.
- **U6′ regression comment** — added an inline note that U6′ is retained specifically as the TOV-160→162 behavior-change regression (the general dust-1 case is PR2).

**Left as-is:** the `PR*`/`B*`/`E-PR*` naming — a deliberate feature cluster (per the plan's Test Plan note); folding into the `U`-sequence was judged not worth the churn. Unit suite: 33/33 green (was 34; −1 = PR8).
