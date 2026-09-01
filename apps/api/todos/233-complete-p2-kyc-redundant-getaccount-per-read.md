---
status: complete
priority: p2
issue_id: 233
tags: [code-review, performance, rpc, TOV-235, PR-33]
dependencies: []
---

# `isAllowed` does a live getAccount per read → 2 RPC round-trips/item, doubling read-phase RPC/429 exposure

## Problem Statement
`isAllowed` builds a real `TransactionBuilder` that requires a fresh `getAccount` purely to simulate a read-only `is_allowed`. That is 2 RPC calls per item in the classify phase (getAccount + simulateTransaction), so a 10-item batch issues up to 20 read-phase calls — doubling the 429 exposure the `RPC_CONCURRENCY = 8` cap is meant to bound. Soroban `simulateTransaction` does not consume sequence and does not need a current/funded source for a read-only invoke.

## Findings
- `src/modules/kyc-allowlist/soroban-kyc-allowlist.service.ts:61-86` (`isAllowed`) calls `this.server.getAccount(...)` before building the simulate tx.
- The submit path correctly simulates once (no double-simulate). The redundancy is only the getAccount-per-read.

## Proposed Solutions
### Option A (recommended): simulate reads against a synthetic account
- Build the `is_allowed` simulate tx against `new Account(this.admin.publicKey(), '0')` instead of `getAccount`. Halves read-phase RPC volume and removes a network dependency from the read path. Verify the installed `@stellar/stellar-sdk` accepts a placeholder sequence for read-only simulate (it does). Effort: Small.

## Recommended Action
**RESOLVED (Option A).** `isAllowed` now builds the read-only simulate tx against `new Account(this.admin.publicKey(), '0')` instead of a live `getAccount`, halving read-phase RPC round-trips (1 simulate/item instead of getAccount+simulate). Unit test asserts `getAccount` is not called on the read path.

## Technical Details
- Affected: `src/modules/kyc-allowlist/soroban-kyc-allowlist.service.ts` (`isAllowed`).

## Acceptance Criteria
- [x] `isAllowed` issues one RPC round-trip (simulate) per read, not two.
- [x] Unit/mocked test confirms no getAccount call in the read path.

## Work Log
- 2026-07-18: created from PR #33 review (performance-oracle P2-2).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — synthetic account for read simulate; test added.
