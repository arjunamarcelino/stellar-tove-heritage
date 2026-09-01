---
status: complete
priority: p2
issue_id: 111
tags: [code-review, correctness, relayer, concurrency]
dependencies: []
---

# submitSignedTransfer maps txBAD_SEQ to terminal TRANSFER_FAILED (502) instead of retryable

## Problem Statement
In `src/modules/relayer/soroban-relayer.service.ts`, the submit send-status `switch` (~lines 320-330)
handles `PENDING`/`DUPLICATE`/`TRY_AGAIN_LATER` but routes `default:` (send status `ERROR`, which
includes a real `txBAD_SEQ`) to `RelayerTransferError('transfer_failed')` → a terminal **502**. A
`txBAD_SEQ` on submit means the transfer NEVER executed, yet the caller sees a terminal money-failure
502 rather than a retryable signal — bad UX on a money surface (no double-spend risk; this fails closed).

## Findings
- The submit lock (`relayer:submit:<pk>`) releases at send, before ledger-apply. The relayer is one
  keypair = one sequence number, so two concurrent submits (or a concurrent deploy + submit, see 112)
  can build the SAME sequence and collide with `txBAD_SEQ` under load.
- The service docstring already calls this out for the DEPLOY path (~lines 88-91), where the collision
  is transparently retried via `isSequenceError` → `SequenceError` (a `RetryableDeployError`).
- On submit the same collision surfaces as a spurious terminal 502 (`default:` branch, ~line 328-329),
  with no use of the existing `isSequenceError` helper. This is a deliberate-looking divergence from
  deploy that is neither documented nor mapped to a retryable code.

## Proposed Solutions

### Option A: Map txBAD_SEQ to a retryable code + document the divergence
- Detect the send `ERROR` result via the existing `isSequenceError(sent.errorResult)` and throw
  `RelayerTransferError('unavailable')` (→ **503**, retryable by the FE) instead of `'transfer_failed'`.
  Add a comment explaining WHY submit does NOT transparently retry the way deploy does (see Option B).
- **Effort:** Small · **Risk:** Low

### Option B: Bounded retry of the send (NOT viable server-side)
- A true retry needs a fresh sequence, but the sequence is baked into the signed envelope and the
  passkey signature covers the auth digest — the server cannot re-sign a rebuilt tx. A real retry would
  require a fresh `/build` + device re-sign, i.e. a client round-trip. Not feasible in-service.
- **Effort:** Large · **Risk:** Medium · **Note:** documented as not-viable; prefer Option A.

## Recommended Action
**Resolved via Option A.** The submit send `default` case now checks `isSequenceError(sent.errorResult)`
and maps a `txBAD_SEQ` to the retryable `unavailable` (503 `RELAYER_UNAVAILABLE`) with a comment on the
deliberate divergence from the deploy path (the signed envelope bakes in the sequence, so the server
can't rebuild+resign — the FE re-/builds). Non-sequence errors still map to terminal `transfer_failed`.

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts` — submit `switch` (~lines 320-330);
  existing `isSequenceError` (~lines 456-463); deploy-path retry precedent (~lines 399-410, 88-91).
- `RelayerTransferError` reasons: `src/modules/relayer/relayer.errors.ts` (`'unavailable'` → 503,
  `'transfer_failed'` → 502 via `wallet-transfer.service.ts` `mapTransferError`).

## Acceptance Criteria
- [x] A `txBAD_SEQ` send maps to a retryable code (503 `RELAYER_UNAVAILABLE`), not a terminal 502.
- [x] A comment documents the deliberate divergence from the deploy path (no server-side re-sign).
- [x] Non-sequence `ERROR` results still map to the terminal `transfer_failed` (502).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `isSequenceError` branch in the submit send switch → `unavailable` (503). Build + lint green.
