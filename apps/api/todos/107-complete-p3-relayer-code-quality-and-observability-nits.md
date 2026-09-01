---
status: complete
priority: p3
issue_id: 107
tags: [code-review, quality, observability, relayer, TOV-21]
dependencies: []
---

# Relayer/passkey code-quality + observability nits (typing, dead branch, sentinel docs, drift CI)

## Problem Statement
Assorted low-severity polish from the factory-deploy review. None affect correctness; grouped to
avoid todo sprawl.

## Findings
1. **`let prepared;` is an evolving-`any`** — `soroban-relayer.service.ts:159-165`. The un-annotated
   try/catch var makes `prepared.sign(...)` effectively unchecked. Extract a typed
   `private prepare(tx): Promise<Transaction>` wrapper and keep the caller on `const prepared`.
2. **Dead branch in `safeStringify`** — `soroban-relayer.service.ts:251-255`. By that point `value`
   is a non-null non-Error without `toXDR`; `JSON.stringify` only throws on circular/BigInt, so the
   `typeof value === 'string' ? value : ...` catch arm can only ever return `'[unstringifiable]'`.
   Collapse to `return '[unstringifiable]'`. (Also the `toXDR` `typeof` check at `:245-250` is
   wrapped in a try/catch that guards nothing.)
3. **`txHash: ''` sentinel overloads the port contract** — `soroban-relayer.service.ts:89,107`;
   `relayer.service.interface.ts:19` types `txHash` as a required `string`. Document `'' = idempotent
   no-op (no submission)` on the interface field, and consider logging the self-heal case explicitly
   instead of `tx=` empty at `passkey.service.ts:175`.
4. **Replay-guard can mask a data anomaly** — `passkey.service.ts:144-151`. The replay branch now
   also requires `existingAddress` truthy; if a passkey-bound wallet ever had a null
   `contract_address` it silently falls through to `PASSKEY_ALREADY_BOUND` (409) instead of
   re-issuing tokens. Log/assert the unexpected null rather than degrading silently.
5. **Derived-address invariant is unenforced in CI** — `soroban-relayer.service.ts:112-117,195-208`.
   The self-heal correctness rests on `deriveWalletAddress` matching the factory's deployer preimage,
   verified only by the gated `RELAYER_LIVE_TESTNET` test (off in CI) + a runtime `warn`. Add a
   golden-vector unit test pinning `deriveWalletAddress(salt)` to a known factory-deployed address so
   a deployer-semantics change fails the build (before mainnet).
6. **DTO example drift** — `passkey-register-response.dto.ts:15,21` truncates the JWT examples where
   `TokenResponseDto` uses full ones. Cosmetic Swagger alignment.
7. **Test cross-module import** — `test/integration/modules/relayer/testnet-deploy.integration.spec.ts:4`
   imports `decodeCoseToRawP256` from `@modules/auth/passkey.helpers`. Minor test-layer coupling; a
   local fixture key would decouple it.

## Proposed Solutions
Batch-fix 1–4, 6, 7 (mechanical); 5 is a small new test worth doing before mainnet.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**RESOLVED — all items done (or already handled by 103).**

## Resolution (2026-07-03)
1. **`let prepared` evolving-`any`** — already eliminated by 103 (removed the try/catch; `const prepared
   = await this.withTimeout('prepareTransaction', ...)` is now properly typed). Moot.
2. **Dead `safeStringify` branch** — `safeStringify` was deleted entirely by 103. Moot.
3. **`txHash: ''` sentinel** — documented on `DeployPasskeyWalletResult.txHash`
   (`relayer.service.interface.ts`): `''` = idempotent no-op (self-heal, no submission).
4. **Replay-guard null masking** — `passkey.service.ts`: a passkey-bound wallet with a null
   `contractAddress` now logs a `warn` (data anomaly) before the 409, instead of silently degrading.
5. **Golden-vector derivation test** — extracted `deriveWalletAddress` into a pure helper
   (`src/modules/relayer/wallet-address.ts`, SDK-aware but network-free); the service now delegates to
   it (removed the private method + the now-unused `hash` import). New `wallet-address.spec.ts` (real
   SDK) pins `deriveWalletAddress(factory, salt(32×0x07), testnet passphrase) ===
   CCS4I77IIMPFP24PP67U2GWV5BXLLSTBJBK25Q347JLIBSCEMHIXLRLW` + a determinism/salt-sensitivity test —
   a CI guard against an accidental preimage change (matching the *real* factory is still the gated
   live test).
6. **DTO example drift** — `passkey-register-response.dto.ts` now uses full-length JWT examples
   matching `TokenResponseDto`.
7. **Test cross-module import** — `testnet-deploy.integration.spec.ts` no longer imports the auth
   helper; a local `freshP256PublicKey()` (`createECDH('prime256v1')`) yields the 65-byte point.
- Verified: lint clean, `yarn build` 0 issues, unit 254, integration 30 (+3 gated), e2e 60.

## Technical Details
- Files: `src/modules/relayer/wallet-address.ts` (new), `soroban-relayer.service.ts`,
  `relayer.service.interface.ts`, `src/modules/auth/passkey.service.ts`,
  `src/modules/auth/dto/passkey-register-response.dto.ts`,
  `test/unit/modules/relayer/wallet-address.spec.ts`,
  `test/integration/modules/relayer/testnet-deploy.integration.spec.ts`.

## Acceptance Criteria
- [x] No evolving-`any` in the prepare path; `safeStringify` dead branch removed (both via 103).
- [x] `txHash` no-op sentinel documented on the port interface.
- [x] Golden-vector test pins `deriveWalletAddress` (CI-enforced).
- [x] Replay null-address anomaly logged; DTO examples aligned; gated test decoupled from auth.

## Work Log
- 2026-07-03: Filed from the factory-deploy multi-agent review (kieran-typescript, architecture-strategist, pattern-recognition, code-simplicity).
- 2026-07-03: **Resolved** all items — see Resolution. Committed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
