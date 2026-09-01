---
status: complete
priority: p2
issue_id: 249
tags: [code-review, performance, reliability, TOV-237, PR-35]
dependencies: []
---

# No overall request time budget for `balancesOf` (slow-but-not-timing-out RPC tail)

## Problem Statement
`withTimeout` bounds each individual simulate at 5s, but there is no wall-clock budget for the whole request. Under a systematically slow RPC (each call just under 5s), waves accumulate with no global ceiling and the client's HTTP connection is held the entire time.

## Findings
Flagged by performance-oracle (P2.2).
- `soroban-fraction-read.service.ts:82-96` (per-call 5s); `fraction-read.config.ts:26`.
- Fail-fast `runBounded` handles the "one bad RPC" case well (first 5s timeout aborts the batch). The dangerous case is **many** slow-but-succeeding calls: worst case `ceil(N/8) × 5s` → N=200 ≈ 125s, N=500 ≈ 315s of held connection + tied-up event loop.

## Proposed Solutions
1. Add `FRACTION_READ_TOTAL_BUDGET_MS` (~10–15s) wrapping `balancesOf`; on exceed, throw `FractionReadUnavailableError` → existing 503 `HOLDINGS_UNAVAILABLE` mapping. Complete-or-nothing preserved (never a partial list). Effort: Small. Risk: low.
2. Rely on todo-247 concurrency + todo-248 single-flight to shrink N-waves; still leaves the tail unbounded. Weaker.

## Recommended Action
**RESOLVED — Solution 1.** Added `FRACTION_READ_TOTAL_BUDGET_MS` (config `totalBudgetMs`, default 8000, Joi 1000–60000) and a `withOverallBudget()` wrapper around the whole `runBounded` fan-out in `balancesOf`. Breaching the budget throws `FractionReadUnavailableError` → existing 503 `HOLDINGS_UNAVAILABLE` mapping (complete-or-nothing preserved). The abandoned fan-out is pre-`.catch`ed so a late worker rejection can't surface as an unhandledRejection.

## Technical Details
- `src/config/fraction-read.config.ts`, `src/config/validation-schema.ts`, `.env.example`, `soroban-fraction-read.service.ts` (`withOverallBudget`). New unit test: budget fires before the per-call timeout on a hung RPC.

## Acceptance Criteria
- [x] Overall deadline caps worst-case holdings latency; breach → 503, never a partial response.
- [x] Unit test covers the budget-breach path (no unhandled rejection).

## Work Log
- 2026-07-18: created from PR #35 review (performance P2.2).
- 2026-07-18: RESOLVED — added total budget wrapper + config + test; build + 7 adapter tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
