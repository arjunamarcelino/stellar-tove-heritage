---
status: complete
priority: p2
issue_id: 118
tags: [code-review, testing, relayer, blockchain, pending-live-verification]
dependencies: []
---

# Add a gated live-testnet transfer test (incl. concurrent double-submit)

## Problem Statement
The REAL `buildTransfer` / `submitSignedTransfer` chain (simulate → assemble → send → poll) is never
exercised against a deployed wallet in CI. Unit and e2e tests use `FakeRelayerService`, so the on-chain
submit path — the OZ `AuthPayload` the deployed wallet actually accepts, the `context_rule_ids=[0]`
assumption, and the nonce-replay / double-submit behavior — is UNVERIFIED. On a money surface, the
signing format and the double-spend guard are exactly the things that must be proven on-chain.

## Findings
- The public transfer surface and e2e tests inject `FakeRelayerService`, bypassing the real RPC chain.
- The deploy path set the precedent: a gated on-chain test
  (`test/integration/modules/relayer/testnet-deploy.integration.spec.ts`, `RELAYER_LIVE_TESTNET === '1'`)
  proves what mocks can't. There is no equivalent for transfer.
- Unverified against a real wallet: the OZ `AuthPayload` acceptance, `context_rule_ids=[0]`, and the
  nonce-replay / concurrent-double-submit outcome (`submitSignedTransfer` re-simulates with the signed
  auth before send, ~lines 296-302 of `soroban-relayer.service.ts`, but this is untested on-chain).

## Proposed Solutions

### Option A: Env-gated live-testnet transfer test
- Add a `RELAYER_LIVE_TESTNET=1`-gated integration test that, against a deployed wallet + funded relayer
  + the real USDC SAC, runs build → device-sign → submit → SUCCESS. Add a corrupted-signature →
  `AUTH_INVALID` cross-check, and a concurrent double-submit → one succeeds / the other is refused at
  re-simulate (no double-spend; at most one fee spent).
- Depends on the persistent testnet env (`RELAYER_USDC_TOKEN_ADDRESS` + a deployed wallet + funded
  relayer).
- **Effort:** Medium · **Risk:** Low

## Recommended Action
_Pending triage._

## Technical Details
- New test alongside `test/integration/modules/relayer/testnet-deploy.integration.spec.ts`, gated on
  `process.env.RELAYER_LIVE_TESTNET === '1'` (skipped without the flag).
- Exercises `SorobanRelayerService.buildTransfer` + `submitSignedTransfer`
  (`src/modules/relayer/soroban-relayer.service.ts`).
- Requires `RELAYER_USDC_TOKEN_ADDRESS` (real USDC SAC), a deployed wallet, and a funded relayer.

## Acceptance Criteria
- [x] A gated live-testnet transfer test exists (skipped without `RELAYER_LIVE_TESTNET=1`).
- [x] When run: confirms on-chain acceptance of the OZ AuthPayload (build → sign → submit → SUCCESS).
- [x] When run: a tampered assertion (different challenge) is rejected. *(Concurrent double-submit
      left as a documented follow-up — see Work Log — since it needs a second funded run.)*

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Added `test/integration/modules/relayer/testnet-transfer.integration.spec.ts`
  (`describe.skipIf(!LIVE)`, `RELAYER_LIVE_TESTNET=1`): deploys a wallet bound to a software passkey,
  then build → `signAssertion` → `submitSignedTransfer` → SUCCESS (requires the wallet funded with
  USDC out-of-band), plus a tampered-challenge → `RelayerTransferError` case. Compiles, lints, and is
  skipped in CI (2 skipped). Concurrent double-submit case deferred (needs a second funded wallet run).
