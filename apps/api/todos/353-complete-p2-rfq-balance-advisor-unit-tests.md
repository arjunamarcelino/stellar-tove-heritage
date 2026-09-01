---
status: complete
priority: p2
issue_id: 353
tags: [code-review, testing, tov-172]
dependencies: []
---
# `RfqBalanceAdvisor` has no direct unit test despite being extracted for testability (PR #46)

## Problem Statement
`RfqBalanceAdvisor` was split out of `RfqsService` explicitly so "the swallow-all semantics live in one focused,
testable place" (its own docstring). But the only coverage is a fully-mocked `balanceAdvisor.warnIfInsufficient`
stub in `rfqs.service.spec.ts`. None of its actual branches are exercised: no-embedded-wallet → `undefined`, RPC
throw → `undefined`, `withRpcTimeout` deadline → `undefined`, sufficient balance → `undefined`, insufficient →
`{ required_stroops, available_stroops }`. The swallow-all logic — the whole reason it exists — is untested.

## Findings
Source: pattern-recognition-specialist (P2).

- `src/modules/marketplace/rfqs/rfq-balance.advisor.ts`
- Gap: `test/unit/modules/marketplace/rfq-balance.advisor.spec.ts` does not exist.

## Proposed Solutions
### Option A — Add a focused advisor unit spec
- Description: New `rfq-balance.advisor.spec.ts` mocking `WalletsService` + `RELAYER_SERVICE`, covering:
  (1) no wallet (`EmbeddedWalletNotFoundError`) → `undefined`; (2) relayer throw → `undefined`; (3) timeout
  (a promise that never resolves within the deadline) → `undefined`; (4) sufficient → `undefined`;
  (5) insufficient → exact `{ required_stroops, available_stroops }` strings; (6) correct token/wallet passed to
  `readWalletHoldings`.
- Pros: Locks the swallow-all contract; catches regressions the service spec's stub can't.
- Cons: The timeout case may need fake timers or a small real delay.
- Effort: Small
- Risk: Low (test-only)

## Recommended Action
Option A — add a focused advisor spec. Approved 2026-08-21.

## Resolution
Added `test/unit/modules/marketplace/rfq-balance.advisor.spec.ts` (7 tests) mocking `WalletsService` +
`RELAYER_SERVICE` + `relayerConfig`: sufficient → undefined (asserts `readWalletHoldings` called with the
resolved wallet + `[usdcTokenAddress]`); insufficient → exact `{ requiredStroops, availableStroops }`;
missing-holding → 0; no wallet (`EmbeddedWalletNotFoundError`) → undefined@debug; relayer failure
(`RelayerTransferError`) → undefined@debug; UNEXPECTED (`TypeError`) → undefined@**warn** (also verifies the
#355 log classification); and a fake-timer test that the >1200ms deadline drops the warning@debug. Verified: 7/7 green.

## Technical Details
- Mirror the mocking style of existing unit specs; `withRpcTimeout` timeout branch is the one needing care.

## Acceptance Criteria
- [ ] All five branches covered; `readWalletHoldings` called with `[usdcTokenAddress]` and the resolved wallet.
- [ ] `yarn test` green.

## Work Log
- 2026-08-21 — Filed from PR #46 review (pattern-recognition-specialist).

## Resources
- PR #46; `rfq-balance.advisor.ts`.
