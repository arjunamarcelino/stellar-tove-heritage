---
status: complete
priority: p2
issue_id: 116
tags: [code-review, typescript, correctness]
dependencies: []
---

# mapTransferError has no assertNever — a new TransferErrorReason silently returns undefined (500)

## Problem Statement
`src/modules/wallets/transfer/wallet-transfer.service.ts` `mapTransferError` (~lines 141-156) switches
over the 6 `TransferErrorReason` members with NO `default: assertNever(reason)`. Adding a 7th reason to
the union (`src/modules/relayer/relayer.errors.ts`) makes this switch fall off the end and return
`undefined` → the caller does `throw undefined` → a **500** on a money path, with no compile-time signal.

## Findings
- `TransferErrorReason` has 6 members today: `simulation_failed`, `expired`, `signature_required`,
  `signature_invalid`, `transfer_failed`, `unavailable` (`relayer.errors.ts` ~lines 7-13).
- `mapTransferError` returns `HttpException` but has no `default` arm; TypeScript does not flag the
  missing return because the switch is presumed exhaustive over today's union.
- Both `build` (~line 72) and `submit` (~line 133) do `throw this.mapTransferError(err.reason)`; an
  `undefined` return becomes `throw undefined` → generic 500.

## Proposed Solutions

### Option A: Exhaustiveness guard on the switch
- Add `default: { const _exhaustive: never = reason; throw _exhaustive; }` (or a shared `assertNever`
  helper) so adding a reason without a mapping becomes a COMPILE error.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved.** Added a `default` case to `mapTransferError` that assigns `reason` to a `never`-typed
`const exhaustive` and returns it — a new `TransferErrorReason` without a mapping is now a compile
error instead of a silent `undefined`/500.

## Technical Details
- File: `src/modules/wallets/transfer/wallet-transfer.service.ts` — `mapTransferError` (~lines 141-156).
- Union source: `src/modules/relayer/relayer.errors.ts` — `TransferErrorReason` (~lines 7-13).

## Acceptance Criteria
- [x] Adding a `TransferErrorReason` without a corresponding mapping is a COMPILE error.
- [x] No runtime path can return `undefined` from `mapTransferError`.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `default: { const exhaustive: never = reason; return exhaustive; }`. Build + lint green.
