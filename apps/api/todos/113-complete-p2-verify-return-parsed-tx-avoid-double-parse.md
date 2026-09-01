---
status: complete
priority: p2
issue_id: 113
tags: [code-review, performance, correctness, relayer]
dependencies: []
---

# submitSignedTransfer re-parses txXdr that verifyPasskeyAuthorization already parsed

## Problem Statement
`verifyPasskeyAuthorization` (`src/modules/relayer/passkey-authorization.ts`, ~lines 69-107) parses
the envelope, walks the op / auth-entry / rootInvocation, and returns `{ authEntry, signatureCompact,
signatureExpirationLedger }` — but the returned `authEntry` is IGNORED by the caller.
`submitSignedTransfer` (`src/modules/relayer/soroban-relayer.service.ts`, ~lines 289-294) then
re-parses the IDENTICAL `txXdr` via `TransactionBuilder.fromXDR`, re-does the op-shape guard, and
attaches the `AuthPayload` to a FRESHLY re-parsed `operation.auth[0]`. Verification and
signature-attachment therefore operate on two independently-parsed copies that agree today only by
coincidence — a redundant full XDR decode on the money hot path AND a correctness smell.

## Findings
- `passkey-authorization.ts` parses `tx` (~line 71), resolves `authEntry` (~line 86), and returns it
  in `VerifiedPasskeyAuthorization.authEntry` (~lines 34-41, 189-193).
- `soroban-relayer.service.ts` discards `verified.authEntry`, calls
  `TransactionBuilder.fromXDR(input.txXdr, ...)` again (~line 289), re-checks the op shape
  (~lines 290-293), and attaches to `operation.auth[0]` (~line 294) — a second parse of the same bytes.
- Two independent parses of the same envelope means the verified entry and the mutated entry are not
  guaranteed to be the same object graph; they align only because the input is identical.

## Proposed Solutions

### Option A: Return the parsed tx/entry from verification; mutate that
- Have `verifyPasskeyAuthorization` return the parsed `tx` (or the mutable op / `authEntry`) alongside
  the existing fields. In `submitSignedTransfer`, attach the encoded `AuthPayload` to the VERIFIED
  entry and re-serialize from that same `tx` — one parse, one mutation target.
- Confirm the returned `tx`/entry object is still mutable and independent before wiring the signature
  onto it (guard against a frozen / shared reference).
- **Effort:** Medium · **Risk:** Low

## Recommended Action
**Resolved.** `VerifiedPasskeyAuthorization` now returns the parsed `tx` (narrowed to `Transaction` via
`instanceof`, so it persists to the return). `submitSignedTransfer` attaches the `AuthPayload` to
`verified.authEntry` (a live reference into `verified.tx`) and re-simulates `verified.tx` — the second
`TransactionBuilder.fromXDR` + the redundant op-shape re-check are gone. One parse, one mutation target.

## Technical Details
- Files: `src/modules/relayer/passkey-authorization.ts` (~lines 34-41, 60-107, 189-193),
  `src/modules/relayer/soroban-relayer.service.ts` (~lines 259-294).
- Behavior must be unchanged; the existing unit tests for verify + submit stay green.

## Acceptance Criteria
- [x] A single `TransactionBuilder.fromXDR` per submit (one full XDR decode).
- [x] The `AuthPayload` is attached to the auth entry that verification validated.
- [x] Behavior unchanged; tests green.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: verify returns `tx`; submit reuses `verified.tx`/`verified.authEntry` (dropped the
  re-parse + shape re-check). Changed the op-count guard to `instanceof Transaction` so the narrowing
  reaches the return. Build + unit (11) + transfer e2e (7) green.
