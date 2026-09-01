---
status: complete
priority: p2
issue_id: 374
tags: [code-review, performance, soroban, tov-175, pr-48]
dependencies: []
---
# Balance read's abandoned RPC socket outlives the 2.5s user deadline (held to the inner 5s) (PR #48)

## Problem Statement
The single on-chain balance read is wrapped in three stacked timers. The effective user-visible deadline is
correctly 2.5s, but when that outer timeout wins the underlying Soroban `simulateTransaction` HTTP request is
only **abandoned, not cancelled** (the Stellar SDK has no AbortController). The inner per-call timer keeps the
socket alive up to `cfg.timeoutMs = 5000ms` — so the RPC socket stays pinned ~2.5s *after* the caller already
received the 503. This surfaces precisely during an RPC brownout (when 2.5s timeouts are firing), roughly
doubling concurrent RPC socket occupancy and accelerating the connection/429 cliff.

## Findings
Source: performance-oracle (P2); corroborated by data-integrity-guardian (P3 note on the timeout stack).
- `src/modules/marketplace/quotes/quotes.service.ts:243-248` — outer `withRpcTimeout(..., QUOTE_BALANCE_TIMEOUT_MS=2500)`.
- `src/modules/fractionalization/me/soroban-fraction-read.service.ts:83,104` — inner per-call `cfg.timeoutMs=5000`.
- `src/modules/fractionalization/me/soroban-fraction-read.service.ts:52-63` — overall `totalBudgetMs=8000`.
- `src/common/soroban/with-rpc-timeout.ts:2-3` — documents that the losing promise is abandoned, not cancelled.
- Effective deadline `min(2500, 5000, 8000) = 2500ms` is correct; the issue is the abandoned socket lifetime,
  not the deadline.

## Proposed Solutions
### Option A — Cap the inner simulate at ≈ the quote deadline for this path (Recommended)
- Call `balancesOf` via a variant / config that bounds the inner `simulateTransaction` timeout at
  ~`QUOTE_BALANCE_TIMEOUT_MS` for the single-token quote read, so an abandoned request is released within ~2.5s
  rather than held to 5s. This also drops the two inner timers that can never fire on this N=1 path.
- Pros: halves worst-case held-socket time during a brownout; bounds RPC occupancy to the user deadline.
- Cons: needs either a per-call timeout parameter on the read port or a dedicated config for this path (the
  shared `fraction-read.config` is used by the holdings fan-out, which legitimately wants 5s).
- Effort: Medium · Risk: Low
### Option B — Accept and monitor
- Keep the stack; rely on the 20/60s throttle + circuit-breaker (deferred) to bound brownout amplification.
- Pros: zero change. Cons: leaves the doubled-socket-lifetime amplification during brownouts.
- Effort: None · Risk: Low-Medium (only bites under sustained RPC degradation)

## Recommended Action
Option A if the read port can accept a per-call deadline without disturbing the holdings fan-out; else Option B
plus the deferred concurrency-bulkhead/circuit-breaker (see plan §Phase 3 optional hardening).

## Resolution (2026-08-22, complete — Option A)
Added an optional `opts?: { timeoutMs?: number }` to `IFractionReadService.balancesOf`. In
`SorobanFractionReadService`, `opts.timeoutMs` now caps BOTH the per-read `withRpcTimeout` and the overall
`withOverallBudget` (threaded via new `perReadMs`/`budgetMs`/`readOne(timeoutMs)` params); omitting it keeps the
config's 5s/8s bounds, so the holdings fan-out is unchanged. `QuotesService.resolveContractAndReadBalance` now
calls `balancesOf([token], wallet, { timeoutMs: QUOTE_BALANCE_TIMEOUT_MS })` and **drops the redundant outer
`withRpcTimeout` wrapper** — so on a timeout the abandoned Soroban request is released at ~2.5s (the inner timer
IS 2.5s now) instead of lingering to 5s. The `FakeFractionReadService` needs no change (it already omits extra
params). Build 0 issues; me-holdings + quotes unit 61/61 green.

## Technical Details (as-built)
- `src/modules/fractionalization/fraction-read.service.interface.ts` — `balancesOf` gains `opts?.timeoutMs`.
- `src/modules/fractionalization/soroban-fraction-read.service.ts` — `perReadMs`/`budgetMs` threading;
  `withOverallBudget(work, budgetMs)`, `readOne(..., timeoutMs)`, `withTimeout(..., timeoutMs)`.
- `src/modules/marketplace/quotes/quotes.service.ts` — pass the deadline into the read; removed the outer
  `withRpcTimeout` + its import. Holdings (`/me/holdings`) unaffected.

## Technical Details
- Affected: `quotes.service.ts` (the read call), possibly `IFractionReadService.balancesOf` signature or a new
  quote-scoped read config. Do NOT lower the shared `fraction-read.config.timeoutMs` (holdings needs it).

## Acceptance Criteria
- [x] On an outer-timeout, the abandoned Soroban request is released within ~`QUOTE_BALANCE_TIMEOUT_MS`, not
      held to the shared 5s `timeoutMs`. → deadline passed into `balancesOf`; inner timer is now 2.5s.
- [x] The holdings (`/me/holdings`) fan-out read is unaffected (still uses its 5s per-call / 8s budget). → holdings
      passes no `opts`, so it keeps the config bounds; 61/61 holdings+quotes unit green.

## Work Log
- 2026-08-22: Filed from PR #48 review (performance-oracle P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
