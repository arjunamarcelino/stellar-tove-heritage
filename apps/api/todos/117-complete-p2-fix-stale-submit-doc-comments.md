---
status: complete
priority: p2
issue_id: 117
tags: [code-review, documentation, relayer, money-surface]
dependencies: []
---

# Stale doc-comments claim submit is unbuilt / claim live-testnet coverage that does not exist

## Problem Statement
Several doc-comments describe the fully-implemented, live-routed submit path as deferred, and one claims
live-testnet coverage that does not exist. On a money surface, a comment asserting a signature-verifying
endpoint "is not built yet" is dangerous drift — a maintainer could assume submit is a stub.

## Findings
- `src/modules/wallets/transfer/wallet-transfer.service.ts` (~lines 23-24): "`submit` … is added once
  the TOV-39 signature format is frozen against the deployed wallet." But `submit` is fully implemented
  (~lines 96-138) and wired to `POST wallet/transfer/submit`.
- `src/modules/relayer/soroban-relayer.service.ts` `buildTransfer` doc (~lines 185-186): "the submit
  half (`submitSignedTransfer`) is added once that is frozen." But `submitSignedTransfer` is implemented
  (~lines 257-336) and routed.
- `submitSignedTransfer` docstring (~lines 253-255): claims the chain orchestration is "covered by the
  gated `RELAYER_LIVE_TESTNET` test." The only live test
  (`test/integration/modules/relayer/testnet-deploy.integration.spec.ts`) is gated on that SAME flag but
  exercises the DEPLOY path ONLY (`deploy_wallet` + address self-heal, ~lines 25-40) — there is NO live
  transfer test. The claim overstates coverage (see 118).

## Proposed Solutions

### Option A: Rewrite the doc-blocks to match reality
- State that submit SHIPS and is guarded by `verifyPasskeyAuthorization` + expiry re-check +
  re-simulate + fee cap. Consolidate the GENUINE remaining caveat into one explicit banner:
  `context_rule_ids=[0]` + the OZ digest binding are UNVERIFIED against the deployed wallet. Correct the
  live-testnet claim — either add the transfer test (see 118) or state submit is not yet live-verified.
- **Effort:** Small · **Risk:** Low

## Recommended Action
_Pending triage._

## Technical Details
- Files: `src/modules/wallets/transfer/wallet-transfer.service.ts` (~lines 17-25),
  `src/modules/relayer/soroban-relayer.service.ts` (~lines 178-187 buildTransfer doc, ~lines 246-256
  submit doc).
- Live test: `test/integration/modules/relayer/testnet-deploy.integration.spec.ts` — deploy-only,
  gated `RELAYER_LIVE_TESTNET === '1'` (~line 23).

## Acceptance Criteria
- [x] No comment claims the submit path is unbuilt / deferred.
- [x] The live-testnet coverage claim matches reality (points at the transfer test added in #118).
- [x] The real caveat (`context_rule_ids=[0]` + OZ digest binding UNVERIFIED against the deployed
      wallet) is stated in one banner on `buildTransfer`.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `WalletTransferService` class doc now says both build+submit ship (submit is
  fail-closed); `buildTransfer` doc carries the single "NOT YET VERIFIED against the deployed wallet"
  banner pointing at the gated `testnet-transfer` test; `submitSignedTransfer` doc references that
  test file. Build + lint green.
