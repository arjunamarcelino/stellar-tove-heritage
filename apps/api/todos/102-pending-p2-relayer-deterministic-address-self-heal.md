---
status: pending
priority: p2
issue_id: 102
tags: [code-review, correctness, blockchain, relayer, pending-live-verification]
dependencies: []
---

# Relayer: Full Idempotent Redeploy (Resolve + Return Existing Contract Address)

## Problem Statement
Split from todo 094. The defensive half shipped: `SorobanRelayerService` now guards the ScVal
discriminant and classifies a duplicate deterministic deploy as a distinct "contract already exists"
error (still a `503 WALLET_DEPLOY_FAILED`, but diagnosable). The remaining half — **true self-heal**:
on a redeploy of the same credential, resolve the deterministic contract address and **return it as
success** instead of failing — is blocked on TOV-38.

Needs the audited WASM's deploy semantics to:
1. Derive the deterministic contract address pre-submit (`HashIdPreimage` from networkId + deployer
   address + `salt = sha256(credentialId)`), matching the exact `createCustomContract` derivation.
2. Query on-chain whether that address already has code (`getLedgerEntries`/`getContractData`) and
   short-circuit to success; and/or reliably recognize the on-chain collision error and return the
   existing address.
3. Lock the `__constructor` ScVal arg layout against the published WASM.

## Findings
- Deterministic salt (`salt = sha256(rawCredentialId)`); the wallet address is derived off-chain from
  the **factory contract** as deployer. Impact of NOT self-healing: a deploy that succeeds on-chain but
  whose DB bind rolls back leaves that credential un-completable. Bounded on testnet; matters for mainnet.

## Proposed Solutions

### Option A: Existence-check + return existing address (implemented)
- Derive the address; `getLedgerEntries` it; if present, return it as success. On a deploy failure,
  re-check on-chain existence and self-heal to the derived address.
- **Effort:** Medium · **Risk:** Low

## Recommended Action
**Implemented (Option A) — no longer TOV-38-blocked; code-complete, pending one live-testnet run.**
The relayer invokes the real testnet `FractionWalletFactory.deploy_wallet` and derives the wallet
address off-chain from the factory `ScAddress` + `salt = sha256(rawCredentialId)`
(`wallet-address.ts`). Self-heal (post-review, todo 103): a proactive `getLedgerEntries` existence-skip
**and** an on-chain `walletExists(derived)` re-check on ANY deploy failure — on-chain state is
authoritative (no error-string parsing). A golden-vector unit test (todo 107) now pins the derivation
in CI against accidental change. **Remaining gate:** the golden vector cannot prove our derived address
equals what the real factory deploys — that needs one funded `RELAYER_LIVE_TESTNET=1` run confirming
`derived === returned` before flipping to `complete` (same gate as todo 094).

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts`, `src/modules/relayer/wallet-address.ts`.
- No longer depends on TOV-38 (derivation done independently via the factory-as-deployer preimage).

## Acceptance Criteria
- [x] Re-deploying the same credentialId returns the existing contract address as success (no failure).
- [x] A rolled-back bind can be retried to completion (unit tests: existence-skip + on-chain-recheck self-heal).
- [x] Interface doc + `auth/CLAUDE.md` state full idempotency.
- [x] Off-chain derivation is guarded in CI against accidental change (golden-vector test, todo 107).
- [ ] **Funded live-testnet run confirms `derived === returned`** (gated `RELAYER_LIVE_TESTNET=1` test) → then flip to `complete`.

## Work Log
- 2026-07-03: Split from todo 094 when the defensive half (ScVal guard + collision classification) shipped.
- 2026-07-03: **Implemented full self-heal** against the real testnet factory (`deploy_wallet` +
  off-chain factory-as-deployer derivation + two-tier existence/revert self-heal). Unblocked from
  TOV-38 (derived independently).
- 2026-07-03: Post-review hardening folded in — self-heal is now on-chain-authoritative
  (`walletExists` re-check, todo 103, replacing the error-string revert classification), derivation
  extracted + golden-vector CI test (todo 107), txBAD_SEQ retry (todo 104). Still `pending` on the one
  funded live-testnet run — the golden vector locks our code but cannot confirm real-factory equivalence.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
- Docs: docs/solutions/integration-issues/soroban-factory-deploy-wallet-encoding-and-derivation.md
- Related: todos 094 (same live-verification gate), 103, 104, 107
