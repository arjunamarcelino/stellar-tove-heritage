---
status: complete
priority: p3
issue_id: 346
tags: [code-review, simplicity, tov-165]
dependencies: []
---
# `absorbedLeftover` in persist() is provably `0n` — could literalize (PR #45)

## Problem Statement
In the settle worker, `absorbedLeftover` is computed as `BigInt(totalSupply) − BigInt(artistRetention) −
BigInt(treasuryRetention) − BigInt(publicFloat)`. Because `CHK_off_public_float_decomposition` guarantees
`public_float === total_supply − artist − treasury` on every offering row, this expression is provably `0n` today,
and the destination `CHK_clearing_absorbed_zero` independently pins it to 0. So it is a 4-BigInt computation that can
only ever yield 0.

## Findings
Source: code-simplicity-reviewer (item 5).

- `src/modules/offerings/settle/offering-settle.processor.ts:272-277` — `absorbedLeftover` residual computation.
- Defensible as documentation: it names the residual relationship `leftover = total − retentions − float` that
  FR-04.06 will make non-zero. But per YAGNI it computes a constant, and FR-04.06 will also have to change the
  `CHK_clearing_absorbed_zero` CHECK and likely the decomposition anyway, so the "future-proofs the arithmetic"
  argument is partial.

## Proposed Solutions
### Option A — Literalize to `'0'` with the existing comment
- Description: Replace the residual computation with `absorbedLeftoverStroops: '0'` and keep the
  `// ≡ 0 until FR-04.06 introduces a non-zero leftover_to_artist` comment.
- Pros: Removes a compute-a-constant expression; intent stays documented.
- Cons: Loses the self-describing residual formula; FR-04.06 re-adds it.
- Effort: Small
- Risk: Low

### Option B — Keep as-is (documentation value)
- Description: Leave the residual expression; it documents the money relationship and is the exact line FR-04.06
  will generalize.
- Pros: Zero churn; the formula is the spec.
- Cons: Computes a provable constant.
- Effort: None
- Risk: None

## Recommended Action
Option A (literalize to `'0'`) — user-confirmed 2026-08-21.

## Resolution
Applied Option A in `offering-settle.processor.ts` persist(): replaced the residual computation with
`const absorbedLeftover = '0'` (+ a comment explaining it is provably 0 via `CHK_off_public_float_decomposition`
and re-asserted by `CHK_clearing_absorbed_zero`; FR-04.06 will reintroduce a non-zero `leftover_to_artist`). The
`insertSnapshot` payload now passes the string directly (dropped the redundant `.toString()`). Unit U18/U19 still
assert `absorbedLeftoverStroops === '0'`. Build 0, unit 875 green.

## Technical Details
- File: `src/modules/offerings/settle/offering-settle.processor.ts:272-277`.

## Acceptance Criteria
- [ ] Decision recorded; if Option A, unit test U19/U18 still assert `absorbedLeftoverStroops === '0'` (they do).

## Work Log
- 2026-08-21: Filed from PR #45 simplicity review. Not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/45
