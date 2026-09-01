---
status: complete
priority: p3
issue_id: 119
tags: [code-review, quality, simplicity]
dependencies: []
---

# WalletTransferService error mapping: fail() ternary + mapTransferError table

## Problem Statement
`WalletTransferService` hand-rolls two pieces of error-mapping boilerplate that partly duplicate what
the global `AllExceptionsFilter` already derives. Both are optional cleanups — the current output is
correct and matches Nest's built-in body shapes; the goal is fewer LOC without changing the wire format.

## Findings
- `fail()` (`wallet-transfer.service.ts` ~lines 159-178) hand-maps 6 HTTP statuses to reason strings
  via a nested ternary (`Not Found` / `Bad Request` / `Unprocessable Entity` / `Conflict` /
  `Bad Gateway` / `Service Unavailable`), duplicating what `AllExceptionsFilter` derives from
  `HttpStatus[status]`. The reason phrases currently DO match Nest's built-ins, so the body shape is
  in parity with `PasskeyService` / `Sep10Service` — any change must preserve that.
- `mapTransferError` (`wallet-transfer.service.ts` ~lines 141-156) is a 6-arm `switch` over
  `TransferErrorReason`, each arm calling `this.fail(ErrorCode.X, HttpStatus.Y)`.

## Proposed Solutions

### Option A: Collapse `fail()` reason derivation
- Replace the ternary with `error: HttpStatus[status]` (yields `NOT_FOUND`, `CONFLICT`, …) or drop the
  `error` field entirely (the filter fills `errorCode` from the object regardless). Saves ~13 lines.
- **Effort:** Small · **Risk:** Low

### Option B: Table-drive `mapTransferError`
- Replace the switch with a `Record<TransferErrorReason, [ErrorCode, HttpStatus]>` lookup + a single
  `this.fail(...MAP[reason])`. Keep exhaustiveness (see todo 116).
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Partially resolved.** `mapTransferError` is now a `static TRANSFER_ERROR_MAP: Record<TransferErrorReason,
[ErrorCode, HttpStatus]>` + a one-line lookup (`this.fail(...MAP[reason])`) — terser and still
exhaustive by construction (a missing key is a compile error, superseding the todo-116 `assertNever`).
The `fail()` reason-phrase ternary was **intentionally left** as-is: it produces the standard Nest
reason phrases (`Not Found`, `Unprocessable Entity`, …) that match the `PasskeyService`/`Sep10Service`
sibling bodies; switching to `HttpStatus[status]` would emit `NOT_FOUND` and break that parity, and
dropping `error` would change the body shape.

## Technical Details
- File: `src/modules/wallets/transfer/wallet-transfer.service.ts` (`fail` ~159-178,
  `mapTransferError` ~141-156).
- The reason strings feed the JSON `error` field; changing to `HttpStatus[status]` (e.g. `NOT_FOUND`
  vs `Not Found`) alters that field's value — decide whether Nest-phrase parity or code-shape parity
  wins, and keep it consistent with `PasskeyService`/`Sep10Service`.

## Acceptance Criteria
- [x] Error bodies remain unchanged in shape (`errorCode` + `statusCode` + reason parity — `fail()`
      untouched).
- [x] Fewer LOC (switch → a Record + one-line lookup).
- [x] Exhaustiveness over `TransferErrorReason` is preserved (the `Record` is structurally exhaustive).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `mapTransferError` → static `TRANSFER_ERROR_MAP` Record lookup; `fail()` kept for
  sibling-parity. Build + service unit tests (7) green.
