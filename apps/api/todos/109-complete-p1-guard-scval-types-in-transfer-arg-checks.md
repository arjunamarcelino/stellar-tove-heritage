---
status: complete
priority: p1
issue_id: 109
tags: [code-review, security, correctness, relayer, typescript]
dependencies: []
---

# Relayer transfer: unchecked scValToNative casts on from/amount args can throw a raw TypeError on the ceiling check

## Problem Statement
In `src/modules/relayer/passkey-authorization.ts` (~lines 117 and 121), the `from` and
amount-ceiling checks decode transfer args with `scValToNative` (typed `=> any`):

- `scValToNative(args[0]) !== input.walletContract` (line 117)
- `(scValToNative(args[2]) as bigint) > BigInt(input.maxTransferAmount)` (line 121)

Both run BEFORE signature verification on a fully attacker-controlled `txXdr`. The `as bigint` is an
unchecked type assertion: if `args[2]` is a non-i128 ScVal, `scValToNative` may return a
number/string/object, and `> BigInt(...)` throws `TypeError: Cannot mix BigInt and other types`
(a non-`RelayerTransferError` → 503) or silently coerces. This is on the single most
security-sensitive line — the amount ceiling. Likewise, `args[0]` compared as `any !== string`
silently accepts type drift instead of rejecting a malformed `from`.

## Findings
- `scValToNative` from `@stellar/stellar-sdk` returns `any`; the code narrows it only via an
  unchecked `as bigint` cast at line 121 and a loose `!==` string compare at line 117.
- A crafted `args[2]` that is not an i128 ScVal (e.g. a symbol, map, or `u32`) makes
  `scValToNative` return a non-bigint; `nonBigInt > BigInt(...)` throws `TypeError` at runtime.
- That `TypeError` is not a `RelayerTransferError`, so it escapes the fail-closed
  `signature_invalid` (422) path and is reclassified by the service catch as
  `RELAYER_UNAVAILABLE` (503).
- `args[0]` compared as `any !== string` can silently pass a non-string decode, weakening the
  `from`-matches-wallet guard.
- Both checks execute pre-signature on attacker-controlled input, so no valid assertion is required
  to reach them.

## Proposed Solutions

### Option A: Assert ScVal discriminants before decoding (recommended)
- For the amount: assert `args[2].switch() === xdr.ScValType.scvI128()` and read the i128 to a
  bigint via a typed path (e.g. the SDK `scValToBigInt`), then guard `typeof amount === 'bigint'`;
  throw `invalid(...)` on mismatch.
- For `from`: assert `args[0]` decodes to a string (address) before the `!==` compare; throw
  `invalid(...)` otherwise.
- **Effort:** Small · **Risk:** Low

### Option B: Wrap the step-3 decode calls in try/catch → invalid(...)
- Surround the `from`/amount decode-and-compare block with `try { … } catch { throw invalid('malformed transfer args'); }`.
- Prevents the raw `TypeError`/503 but is coarser than explicit discriminant assertions and hides
  the specific mismatch.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved via Option A (explicit discriminant assertions).** `from` (`args[0]`) is decoded to
`unknown` and refused unless `typeof === 'string'` and equal to the wallet. The amount (`args[2]`) is
guarded by `args[2].switch() === xdr.ScValType.scvI128()` before reading it with the typed
`scValToBigInt` (replacing the unchecked `as bigint`), so a non-i128 arg is a clean refusal instead of
a raw `TypeError` on the ceiling comparison.

## Technical Details
- Affected file: `src/modules/relayer/passkey-authorization.ts` (arg-checks block; added
  `scValToBigInt` import; replaced `scValToNative(args[2]) as bigint` with an `scvI128` guard +
  `scValToBigInt`).

## Acceptance Criteria
- [x] A crafted `txXdr` with a non-i128 amount arg yields `RELAYER_SIGNATURE_INVALID` (422), never a
      raw `TypeError` or a 503.
- [x] A crafted `txXdr` with a non-address `from` arg yields `RELAYER_SIGNATURE_INVALID` (422) (`from`
      decoded as `unknown`, `typeof === 'string'` guard).
- [x] The amount is only compared once it is confirmed to be a `bigint`; no unchecked `as bigint`.
- [x] Unit test added for the non-i128 amount case (the `TypeError`-prone line). The non-address
      `from` case is covered by the `typeof !== 'string'` guard (existing wrong-`from` test covers a
      valid-but-wrong address).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: added `scValToBigInt` import; replaced the unchecked `as bigint` with an
  `scvI128` discriminant guard + typed read, and asserted `from` decodes to a string. Added unit test
  `refuses a transfer whose amount arg is not an i128` (scvSymbol amount → `RELAYER_SIGNATURE_INVALID`).
  Build + `passkey-authorization.spec.ts` (11 tests) green. Marked complete.
