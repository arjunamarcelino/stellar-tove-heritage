---
status: complete
priority: p3
issue_id: 121
tags: [code-review, data-integrity, security, relayer]
dependencies: []
---

# Transfer port hardening: recipient re-validation, i128 bound at the port, credential↔on-chain-key drift observability

## Problem Statement
Three forward-looking integrity items on the passkey-signed transfer port. None is a live bug — the
passkey signature and on-chain re-simulation already fail-close — but each closes a defense-in-depth
or observability gap that would matter under future key-rotation / recovery work.

## Findings
1. **Recipient not re-pinned.** `/submit` re-pins from/token/amount (`passkey-authorization.ts` checks
   `args[0]` = wallet contract and `args[2]` ≤ `maxTransferAmount`) but NOT the recipient `args[1]`.
   A self-built tx can therefore send to any SAC-accepted address. This is an accepted risk (the
   passkey signed the exact tx), but it is undocumented.
2. **i128 bound only on the build path.** The `0 < amount ≤ i128_max` / positivity bound lives in
   `scaleAmountToI128` (`amount.ts`, build path only). `IRelayerService.buildTransfer` accepts
   `amountScaled: string` and `soroban-relayer.service.ts:195` re-wraps it via
   `nativeToScVal(BigInt(input.amountScaled), { type: 'i128' })` with no independent bound at the port.
3. **Credential ↔ on-chain-key drift is opaque.** The DB credential (`PasskeyCredential.publicKey`) and
   the on-chain bound signer are independent stores. If they ever drift (future key-rotation/recovery),
   off-chain verify passes against the stored key but re-simulation fails on-chain — no fee burned,
   fail-closed — surfacing only as a generic `simulation_failed`.

## Proposed Solutions

### Item 1: recipient handling
- Either document `args[1]` as intentionally unconstrained (the passkey signed it), or re-decode and
  validate `args[1]` as a G/C StrKey, mirroring the existing amount-ceiling check.
- **Effort:** Small · **Risk:** Low

### Item 2: port-level i128 bound
- Re-assert `0 < amountScaled ≤ i128_max` inside `buildTransfer`, or document that the port trusts the
  caller for the bound.
- **Effort:** Small · **Risk:** Low

### Item 3: drift observability
- Emit a DISTINCT warning log when re-simulation fails AFTER off-chain verification already passed, so
  a future key-rotation/recovery drift bug is observable rather than an opaque `simulation_failed`.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved (all three).** (1) `verifyPasskeyAuthorization` now asserts `to` (`args[1]`) decodes to a
string address (defensive — a self-built tx can't smuggle a non-address recipient). (2) `buildTransfer`
re-asserts the amount is a positive i128 (`0 < amount ≤ I128_MAX`) at the port boundary before
`nativeToScVal`, rather than trusting the raw `amountScaled` string. (3) The post-verify re-simulation
failure now logs a distinct diagnostic that names DB-credential-drift-from-the-on-chain-signer as a
possible cause (alongside replay / insufficient balance), so a future key-rotation bug is observable.

## Technical Details
- Files: `src/modules/relayer/passkey-authorization.ts` (`args[0]`/`args[2]` checks ~lines 117-121,
  `args[1]` unchecked), `src/modules/relayer/soroban-relayer.service.ts` (`buildTransfer` amount wrap
  ~line 195; post-verify re-sim ~lines 298-302), `src/modules/relayer/relayer.service.interface.ts`
  (`buildTransfer` / `amountScaled`), `src/modules/wallets/transfer/amount.ts` (build-path bound).

## Acceptance Criteria
- [x] Recipient (`args[1]`) re-validated (must decode to an address string).
- [x] The port (`buildTransfer`) re-asserts the i128 bound (`0 < amount ≤ 2^127-1`).
- [x] A re-simulation failure after off-chain verify passed logs a distinct diagnostic (names credential drift).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: recipient shape check + port i128 bound + drift-aware re-sim log. Build +
  passkey-authorization tests (11) green.
