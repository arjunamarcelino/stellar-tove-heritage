---
status: complete
priority: p2
issue_id: 115
tags: [code-review, security, correctness, relayer, fail-closed]
dependencies: []
---

# verifyP256Assertion throws a raw Error (not RelayerTransferError) and is uncaught in the verify gate

## Problem Statement
`src/modules/relayer/secp256r1.ts` `verifyP256Assertion` throws a plain `Error` when the public key
isn't 65 bytes / doesn't start with `0x04`, or when the signature isn't 64 bytes (~lines 54-59). In
`src/modules/relayer/passkey-authorization.ts` (step 6, ~lines 172-187) only `toLowSCompactSignature`
is wrapped in try/catch; the `verifyP256Assertion` call (~lines 178-187) is NOT. A throw there is a
non-`RelayerTransferError`, so the service falls through to `RELAYER_UNAVAILABLE` (**503**) instead of
`signature_invalid` (**422**) — a latent fail-open-shape inside a fail-closed gate.

## Findings
- `verifyP256Assertion` throws raw `Error` on a bad public-key or signature shape (`secp256r1.ts`
  ~lines 54-58), rather than returning `false`.
- In `passkey-authorization.ts`, the `try/catch` (~lines 173-177) covers ONLY
  `toLowSCompactSignature`; the subsequent `verifyP256Assertion(...)` (~lines 178-187) is unguarded.
- Not currently reachable with attacker input: `boundPublicKey` always comes from
  `decodeCoseToRawP256` (`wallet-transfer.service.ts` ~line 110), which enforces the 65-byte `0x04`
  shape, and `signatureCompact` is already normalized to 64 bytes by `toLowSCompactSignature`. But a
  future caller / data anomaly would surface as a 503 rather than the correct 422, and the whole gate's
  failure surface is supposed to be `RelayerTransferError`.

## Proposed Solutions

### Option A: Wrap the verify call so any throw maps to signature_invalid (422)
- Extend the try/catch (or add one) around `verifyP256Assertion` so any internal throw becomes
  `invalid('signature verification failed')`, keeping the entire verify gate's failure surface inside
  `RelayerTransferError`.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved.** The `verifyP256Assertion` call was moved inside the same try/catch as
`toLowSCompactSignature`, so any throw (malformed signature OR malformed bound key) maps to
`invalid('signature verification failed')` (422) instead of escaping as a raw `Error` (503).

## Technical Details
- Files: `src/modules/relayer/secp256r1.ts` (~lines 48-64), `src/modules/relayer/passkey-authorization.ts`
  (~lines 171-187).
- `RelayerTransferError('signature_invalid')` → 422; a raw `Error` escaping verify → 503 via
  `wallet-transfer.service.ts` catch-all.

## Acceptance Criteria
- [x] Any internal throw in the verify gate (incl. `verifyP256Assertion`) maps to 422, never 503.
- [x] The gate's entire failure surface is `RelayerTransferError`.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `verifyP256Assertion` now runs inside the try/catch → `signature_invalid`.
  Build + passkey-authorization tests (11) green.
