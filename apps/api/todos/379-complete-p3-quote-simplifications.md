---
status: complete
priority: p3
issue_id: 379
tags: [code-review, simplification, tov-175, pr-48]
dependencies: []
---
# Small simplifications in the quote service/repo (PR #48)

## Problem Statement
A handful of safe, behavior-preserving cleanups that reduce surface without touching any deliberate belt.

## Findings
Sources: code-simplicity-reviewer (P3-1/P3-2), kieran-typescript-reviewer (P3-3/P3-4/P3-5).
1. **`BalanceInputs` is dead weight.** `resolveContractAndReadBalance` returns `{ fractionContractId,
   tokenAddress, onchain }` but the caller only reads `.onchain` (`quotes.service.ts:140`);
   `fractionContractId` is already in scope and `tokenAddress` is never read post-return. → return `bigint`.
   (`quotes.service.ts:35-40`, `:254`.)
2. **`insertOpen` hand-copies every `NewQuote` field.** `.values({ rfqId: quote.rfqId, … })`
   (`quote.repository.ts:27-35`) re-lists all 7 columns just to add `status: Q_OPEN`. `NewQuote` is exactly the
   insertable columns → `.values({ ...quote, status: Q_OPEN })` (stays type-checked). (Tradeoff: the explicit
   list documents intent; optional.)
3. **`insufficientFreeBalance` takes a `number`.** `quotes.service.ts:143/258/265` — the caller already has
   `required: bigint` in scope; passing it and formatting `requiredCount: required.toString()` keeps the money
   envelope uniformly BigInt-derived (removes the lone `number` in the 422 builder). Not a bug (count ≤
   MAX_SAFE_INTEGER).
4. **Replay cast lacks the RFQ precedent's safety comment.** `quotes.service.ts:81`
   `return begin.body as QuoteResponseDto;` — copy the one-line justification from `rfqs.service.ts:80-83`
   (the stored snapshot is the exact prior `complete()` body, round-tripped as opaque JSON) so a future reader
   doesn't "harden" it incorrectly.

## Proposed Solutions
### Option A — Apply 1, 3, 4; optionally 2 (Recommended)
- 1 (return `bigint`) and 4 (comment) are pure wins; 3 keeps money BigInt-uniform; 2 is a taste call (spread vs
  explicit list).
- Pros: less surface, clearer intent, zero behavior change. Cons: none material.
- Effort: Small · Risk: Low
### Option B — Leave as-is
- All items are cosmetic; the code is correct and precedent-consistent.
- Effort: None · Risk: None

## Recommended Action
Option A: apply items 1, 3, 4 (and 2 if the team prefers the spread). Verify unit + integration stay green.

## Resolution (2026-08-22, complete — Option A, all four)
1. `resolveContractAndReadBalance` now returns `bigint` (`onchain`); deleted the `BalanceInputs` interface and
   the 3-field object; caller uses `const onchain = ...` / `free = onchain - locked`.
2. `insertOpen` `.values({ ...quote, status: Q_OPEN })` (applied in #373).
3. `insufficientFreeBalance(required: bigint, free)` — `requiredCount: required.toString()`; the 422 envelope is
   now uniformly BigInt-derived (no lone `number`).
4. Added the RFQ-precedent safety comment to the replay cast (`begin.body as QuoteResponseDto`).
(Also switched `QuoteRepository.softRemove` from `async throw` to `return Promise.reject(...)` to satisfy
`require-await` while keeping the rejected-promise contract.) Build 0; eslint 0; quote unit 26 / integration 14
/ e2e 16 green.

## Technical Details
- Affected: `quotes.service.ts`, `quote.repository.ts`. No schema/contract change.

## Acceptance Criteria
- [x] `resolveContractAndReadBalance` returns `bigint`; `BalanceInputs` removed.
- [x] The 422 builder derives `requiredCount` from the in-scope `bigint` (`required.toString()`).
- [x] Replay cast carries the safety justification comment.
- [x] Tests still green (26 / 14 / 16).

## Work Log
- 2026-08-22: Filed from PR #48 review (code-simplicity-reviewer, kieran-typescript-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
