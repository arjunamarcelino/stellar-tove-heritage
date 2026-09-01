---
status: complete
priority: p1
issue_id: 108
tags: [code-review, security, correctness, relayer, fail-closed]
dependencies: []
---

# Relayer transfer: guard host-function discriminant before invokeContract() (runtime-throw bypasses fail-closed contract)

## Problem Statement
In `src/modules/relayer/passkey-authorization.ts` (~line 104), `verifyPasskeyAuthorization`
calls `op.func.invokeContract()` after only guarding `op.type === 'invokeHostFunction'` — the
OPERATION type (line 79), not the host-function arm. `op.func` is an `xdr.HostFunction` union that
can also be `hostFunctionTypeCreateContract` / `…UploadContractWasm` / `…CreateContractV2`. The
`invokeContract()` XDR union accessor THROWS a raw `Error` at runtime when the union is on a
different arm.

A crafted `txXdr` carrying an `invokeHostFunction` op whose `func` is a create-contract host
function reaches this line and throws a plain `Error` (not a `RelayerTransferError`), escaping the
fail-closed error contract. It surfaces as a generic `RELAYER_UNAVAILABLE` (503) via the service
catch instead of `signature_invalid` (422). This is a fail-open-SHAPED latent bug on a money
surface: verification runs on fully attacker-controlled `txXdr` BEFORE the signature is checked.

## Findings
- The op-type guard (`op.type !== 'invokeHostFunction'`, line 79) constrains the Stellar OPERATION
  type but says nothing about which arm of the `xdr.HostFunction` union `op.func` is on.
- `op.func.invokeContract()` (line 104) is a generated XDR union accessor: reading it while the
  union discriminant is not `hostFunctionTypeInvokeContract` throws a raw `Error`.
- That raw throw is not a `RelayerTransferError`, so it bypasses the terminal
  `signature_invalid` (422) contract and is reclassified by the service-level catch as
  `RELAYER_UNAVAILABLE` (503) — an availability error for what is actually a bad/adversarial input.
- Trigger surface is pre-signature and fully attacker-controlled (`txXdr` round-tripped through the
  client), so this is reachable without any valid passkey assertion.

## Proposed Solutions

### Option A: Guard the host-function discriminant before decoding (recommended)
- Before calling `op.func.invokeContract()`, add:
  `if (op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) throw invalid('host function is not invokeContract');`
- **Effort:** Small · **Risk:** Low

### Option B: Wrap the decode in try/catch → invalid(...)
- `try { opInvocation = op.func.invokeContract(); } catch { throw invalid('host function is not invokeContract'); }`
- Catches the raw throw but is less precise than an explicit discriminant guard and swallows any
  unrelated decode failure under the same message.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved via Option A (explicit discriminant guard).** A `hostFunctionTypeInvokeContract` check
was added immediately after the auth-entry `contractFn` guard and before `op.func.invokeContract()`,
throwing `invalid('host function is not a contract invocation')` (a terminal `RelayerTransferError`
→ 422) on any other host-function arm.

## Technical Details
- Affected file: `src/modules/relayer/passkey-authorization.ts` (~line 104; guard follows the
  op-type check at line 79 and precedes the `invocationsEqual` comparison at line 105).

## Acceptance Criteria
- [x] A `txXdr` whose single `invokeHostFunction` op carries a non-invokeContract host function
      yields `RELAYER_SIGNATURE_INVALID` (422), never a raw throw or a 503.
- [x] The discriminant is checked explicitly before any `invokeContract()` accessor call.
- [x] Unit test added covering a create-contract (or upload-wasm) host function reaching this path.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: added the `hostFunctionTypeInvokeContract` discriminant guard in
  `passkey-authorization.ts` before `op.func.invokeContract()`. Added unit test
  `refuses an invokeHostFunction op whose host function is not invokeContract (108)` (an upload-wasm
  op → `RELAYER_SIGNATURE_INVALID`). Build + `passkey-authorization.spec.ts` (10 tests) green. Marked complete.
