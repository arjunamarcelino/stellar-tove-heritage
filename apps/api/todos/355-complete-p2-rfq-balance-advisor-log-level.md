---
status: complete
priority: p2
issue_id: 355
tags: [code-review, observability, tov-172]
dependencies: []
---
# Soft-warn advisor logs at `debug`, hiding misconfiguration and real bugs (PR #46)

## Problem Statement
`RfqBalanceAdvisor.warnIfInsufficient`'s blanket `catch` returns `undefined` for *every* failure and logs only at
`debug` (below production log level). A persistent misconfiguration (wrong `usdcTokenAddress`, RPC consistently
down, a wallet-resolution bug) would silently disable the balance-warning feature with **zero production signal**,
and a genuine `TypeError` in the read path is indistinguishable from "chain temporarily unavailable." The
fail-open behavior is correct (creation must not block); the observability is the gap.

## Findings
Source: kieran-typescript-reviewer (P2).

- `src/modules/marketplace/rfqs/rfq-balance.advisor.ts:48-51`

## Proposed Solutions
### Option A — Log unexpected errors at `warn`; keep timeouts/expected at `debug`
- Description: Distinguish an expected soft failure (`EmbeddedWalletNotFoundError`, `RelayerTransferError`,
  the `withRpcTimeout` timeout) — log at `debug` — from an unexpected error — log at `warn` (or increment a
  metric/counter). Preserve the fail-open return `undefined` in all cases.
- Pros: A systemic failure becomes observable without changing behavior; cheap.
- Cons: Slightly more branching in the catch.
- Effort: Small
- Risk: Low

### Option B — Add a dropped-warning metric only
- Description: Keep the log at debug but emit a counter for "balance warning dropped" tagged by reason.
- Pros: Dashboards/alerts catch a rising drop rate.
- Cons: Requires a metrics facility if none exists on this path.
- Effort: Small-Medium
- Risk: Low

## Recommended Action
Option A — classify expected vs unexpected. Approved 2026-08-21.

## Resolution
Added `isExpectedSoftFailure(err)` to `RfqBalanceAdvisor`: `EmbeddedWalletNotFoundError`,
`RelayerTransferError`, and the `withRpcTimeout` deadline ('timed out') are logged at `debug`; any other error
(misconfig, TypeError, wrong `usdcTokenAddress`) is logged at `warn` so a systemic failure that silently
disables the warning is observable. Fail-open behavior unchanged — still returns `undefined`, RFQ still
created. Branch coverage lands with todo #353 (advisor unit spec). Verified: build 0.

## Technical Details
- Pairs with todo #350 — a persistently slow/erroring chain should surface, not silently degrade the warning UX.

## Acceptance Criteria
- [ ] An unexpected (non-timeout, non-expected-type) failure in the advisor is observable at `warn` or via a metric.
- [ ] Fail-open behavior unchanged (still returns `undefined`, RFQ still created).

## Work Log
- 2026-08-21 — Filed from PR #46 review (kieran-typescript-reviewer).

## Resources
- PR #46; `rfq-balance.advisor.ts`.
