---
status: complete
priority: p2
issue_id: 134
tags: [code-review, architecture, dry, export, TOV-40]
dependencies: []
---

# Extract the shared relayer-error → HttpException mapper (transfer + export duplicate it)

## Problem Statement
`TRANSFER_ERROR_MAP` (`Record<TransferErrorReason, [ErrorCode, HttpStatus]>`) is byte-identical between the transfer and export services, and both re-implement the `mapRelayerError`/`fail()` translation. The relayer error taxonomy is owned by `relayer.errors.ts`; its HTTP mapping now lives in two places and will drift when a new `TransferErrorReason` is added (only one copy would be updated). The two `fail()` bodies also already diverge: transfer emits an `error` reason phrase ("Conflict", …); export omits it — so error envelopes across the two money surfaces are inconsistent.

## Findings
- `src/modules/wallets/transfer/wallet-transfer.service.ts:31-38,157-176`.
- `src/modules/wallets/export/wallet-export.service.ts:40-47,364-375`.
- Both consume `TransferErrorReason` from `@modules/relayer/relayer.errors`.

## Proposed Solutions

### Option A: Shared mapRelayerTransferError(err, message) helper + unified envelope
- **Description:** Move the map + a `mapRelayerTransferError(err): HttpException` into a shared module (e.g. `src/modules/relayer/transfer-error-http.ts`). Both services call it with their own message. Standardize the `fail()` envelope (`{ statusCode, error, message, errorCode }`) — adopt the cleaner export form but keep the `error` reason phrase for consistency.
- **Pros:** Single compile-time-exhaustive mapping; consistent error bodies across the two money surfaces; a new reason is mapped once.
- **Cons:** Minor churn in both services.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — shared helper + unified envelope (confirmed).

## Implemented Solution
Added `src/modules/relayer/transfer-error-http.ts` with the single `TRANSFER_ERROR_MAP`
(`Record<TransferErrorReason, [ErrorCode, HttpStatus]>` — compile-time-exhaustive), `transferErrorMapping`,
`failHttp(errorCode, status, message)` (object-form HttpException with the reason phrase), and
`mapRelayerTransferError(err, message)`. Both `WalletTransferService` and `WalletExportService` now
delegate their thin `fail()`/`mapRelayerError`/`mapTransferError` wrappers to these (each keeping its own
message: "Transfer request failed" / "Export request failed"), and both static maps were deleted. The
export error envelope now also carries the `error` reason phrase, matching transfer (unified). Adding a
new `TransferErrorReason` is now a compile error in exactly one place.

## Technical Details
Affected: `src/modules/relayer/transfer-error-http.ts` (new), `wallet-transfer.service.ts` +
`wallet-export.service.ts` (delegate + drop the duplicated map/reason-phrase ladder). The 16 export
`this.fail(...)` call sites are unchanged (kept the thin private wrapper). Transfer unit tests (which
assert the mapping) stay green, confirming preserved behavior.

## Acceptance Criteria
- [x] One shared mapper used by both services.
- [x] Consistent error envelope across transfer + export.
- [x] Adding a `TransferErrorReason` is a single-place compile error.

## Work Log
- 2026-07-14: Filed from PR #25 review (architecture + simplicity + pattern reviewers).
- 2026-07-15: Extracted the shared helper; both services delegate. build + lint + 305 unit + 16 e2e green. Marked complete.
