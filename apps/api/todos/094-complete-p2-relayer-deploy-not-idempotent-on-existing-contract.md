---
status: complete
priority: p2
issue_id: 094
tags: [code-review, correctness, blockchain, relayer, tov-21, tov-38]
dependencies: [TOV-38]
---

# Soroban Relayer: Deploy Is Not Idempotent on "Contract Already Exists" + Unguarded ScVal

## Problem Statement
`SorobanRelayerService.doDeploy` unconditionally builds → `prepareTransaction` → `sendTransaction`
for `Operation.createCustomContract` with `salt = sha256(credentialId)`. There is **no
existence-check-then-skip and no catch for a "contract already exists" outcome**. This contradicts
two things the code itself promises:
- `relayer.service.interface.ts` doc: "an already-deployed address resolves to success."
- `passkey.service.ts` / `auth/CLAUDE.md`: "the contract self-heals on retry."

Concrete failure: if a deploy succeeds on-chain but the subsequent DB bind rolls back (e.g. a
`users.email` 23505 race in `createEmbeddedPasskeyWallet`, or a lost response), retrying the same
credential re-derives the same deterministic address and re-submits `createCustomContract` → the tx
fails ("contract already exists") → surfaced as `503 WALLET_DEPLOY_FAILED`. That specific credential
becomes permanently un-completable (the user must enroll a brand-new passkey → new salt).

Separately, `pollForResult` returns a bare `xdr.ScVal` and calls `result.address()` with no
discriminant guard — if `returnValue` is ever not an `scvAddress` (wrong WASM return / RPC quirk), it
throws an opaque XDR union error (caught → 503, but undiagnosable). This sits exactly on the
un-finalized TOV-38 WASM boundary.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:70-113` — `doDeploy`: no pre-submit existence check, no "already exists" catch.
- `src/modules/relayer/soroban-relayer.service.ts:107-110` — `StrKey.encodeContract(Address.fromScAddress(result.address()).toBuffer())` with no `result.switch()` guard.
- `src/modules/relayer/relayer.service.interface.ts:22-29` — documents idempotency the impl does not provide.
- Flagged independently by security-sentinel (P3), performance-oracle (L2), kieran-typescript-reviewer (MEDIUM).

## Proposed Solutions

### Option A: Existence-check + catch, tied to TOV-38 finalization (recommended)
- Before submit, resolve the deterministic contract address and query it (`getContractData`/`getLedgerEntries`); if it already has code, return that C-address as success. Also wrap the submit and treat a "contract already exists" ledger error as success (fetch the existing address). Add a `result.switch()` guard before `.address()` and throw a clear diagnostic otherwise.
- **Pros:** Delivers the documented idempotency; makes rolled-back binds cheaply retryable; robust to the WASM boundary.
- **Cons:** Requires the exact deterministic-address derivation (deployer, salt, network) + WASM/`__constructor` layout — both TOV-38 deliverables. Cannot be finalized/tested against a real network until then.
- **Effort:** Medium · **Risk:** Low (fake relayer covers all current tests)

### Option B: Downgrade the docs to match the code
- Remove the "resolves to success"/"self-heals on retry" claims until Option A lands.
- **Pros:** Honest now. **Cons:** Leaves the retry gap. **Effort:** Small · **Risk:** Low

## Recommended Action
**Option A, defensive half** shipped 2026-07-03 (ScVal guard + collision classification). Full deterministic-address self-heal split into **todo 102** (TOV-38-blocked).

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts`, `src/modules/relayer/relayer.service.interface.ts`
- Blocked on TOV-38 (audited WASM + deterministic-address derivation + constructorArgs spec).

## Acceptance Criteria (shipped scope)
- [x] `doDeploy` guards the ScVal discriminant and throws a clear error on a non-address return.
- [x] A duplicate deterministic deploy is classified as a distinct "contract already exists" error (diagnosable), not an opaque failure.
- [x] Class doc no longer over-promises idempotency; the full self-heal is tracked in todo 102.
- [>] Full idempotent self-heal (resolve + return the existing address) -> **todo 102** (blocked on TOV-38).

## Work Log
- 2026-07-02: Filed from PR #21 multi-agent code review (security, performance, TS reviewers converged).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- Related: TOV-38 (smart-wallet WASM)
- 2026-07-03: RESOLVED (defensive scope). Added ScVal discriminant guard before `.address()`; `prepareTransaction`/`sendTransaction`/`getTransaction` failures now route through `deployError()`, which classifies host-error "ExistingValue/already exist" as a distinct clear error. Softened the class idempotency claim. 2 new unit tests (guard + collision). Split full self-heal to todo 102. Build+lint+relayer tests green.
