---
status: complete
priority: p2
issue_id: 250
tags: [code-review, architecture, tech-debt, soroban, TOV-237, PR-35]
dependencies: []
---

# Extract a shared `withTimeout` — 4th near-identical copy across Soroban services

## Problem Statement
`soroban-fraction-read.service.ts` adds the **fourth** private `withTimeout` (`Promise.race` + `clearTimeout` in `finally` + pre-attached `.catch(()=>undefined)`). At two copies this was arguable precedent; at four it is a clear extraction candidate that will keep accreting with every new Soroban adapter.

## Findings
Flagged by architecture-strategist (P2). Pattern-recognition-specialist notes per-service duplication is the *current* convention (so this is a deliberate refactor, not a defect).
- Copies: `soroban-fraction-read.service.ts:82-96`, `soroban-fraction-factory.service.ts:307`, `soroban-kyc-allowlist.service.ts:166`, `soroban-relayer.service.ts:564`. Behaviorally equivalent (each reads its own `cfg.timeoutMs` / const + a domain-tagged message).

## Proposed Solutions
1. Add `withTimeout(label, promise, ms)` in `@common/` (e.g. `common/soroban/with-timeout.ts` or `common/async/`) and refactor all four onto it, passing the per-service timeout + label. Effort: Medium (4 call sites + tests). Risk: low (pure refactor; behavior preserved).
2. Leave as-is (accepted duplication convention), tracked here. Effort: none.

## Recommended Action
**RESOLVED — Solution 1.** Added `src/common/soroban/with-rpc-timeout.ts` (`withRpcTimeout(tag, label, promise, timeoutMs)`) preserving the pre-attached `.catch` + `finally` timer-clear semantics. Refactored all four adapters' private `withTimeout` to a one-line delegation (call sites unchanged), each passing its own tag + timeout: relayer (`'relayer'`, 5000), fraction-factory (`'fraction'`, 5000), kyc-allowlist (`'kyc allowlist'`, RPC_TIMEOUT_MS), fraction-read (`'fraction read'`, cfg.timeoutMs). Message text standardized ("… RPC timed out after Nms: label") — no test asserts the old text.

## Technical Details
- New: `src/common/soroban/with-rpc-timeout.ts`. Edited: `soroban-relayer.service.ts`, `soroban-fraction-factory.service.ts`, `soroban-kyc-allowlist.service.ts`, `soroban-fraction-read.service.ts`.

## Acceptance Criteria
- [x] One shared helper consumed by all four services.
- [x] All soroban unit tests green (144 across relayer/kyc-allowlist/fractionalization/me-holdings).

## Work Log
- 2026-07-18: created from PR #35 review (architecture-strategist P2).
- 2026-07-18: RESOLVED — extracted `withRpcTimeout`; all 4 adapters delegate; build + 144 unit tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
