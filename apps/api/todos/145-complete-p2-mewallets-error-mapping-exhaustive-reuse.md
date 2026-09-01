---
status: complete
priority: p2
issue_id: 145
tags: [code-review, quality, architecture, wallets, TOV-24]
dependencies: []
---

# `MeWalletsService` error mapping is non-exhaustive and reinvents the shared `failHttp` pattern

## Problem Statement
`MeWalletsService.mapMutationError` is a `switch` with no `default`, typed to return `HttpException`. If a
new `WalletMutationReason` is ever added it returns `undefined` at runtime → `throw undefined` → generic 500
(TS won't catch it without an exhaustiveness guard). Separately, the bespoke `http()` builder duplicates the
codebase's canonical `failHttp` + `REASON_PHRASE` pattern (`relayer/transfer-error-http.ts`), which this very
module already consumes for TOV-40 export errors — the nested-ternary status→phrase ladder is exactly what
`REASON_PHRASE` exists to replace. Flagged independently by 5 reviewers (kieran P1, pattern P2, simplicity
P2, architecture P3).

## Findings
- `src/modules/wallets/export/me-wallets.service.ts` — `mapMutationError` (`switch` on `err.reason`, no
  `default`/`assertNever`); `http()` (5-way nested ternary for the reason phrase + a `BadRequestException`
  special-case).
- Precedent: `src/modules/relayer/transfer-error-http.ts` — `REASON_PHRASE: Partial<Record<HttpStatus,string>>`
  + `failHttp(errorCode, status, message)` producing the identical `{ statusCode, error, message, errorCode }`
  body; used by `WalletTransferService` and `WalletExportService`.
- `src/common/filters/all-exceptions.filter.ts` already backfills `error: HttpStatus[status]` when omitted,
  so the phrase ladder isn't even load-bearing.

## Proposed Solutions

### Option A: `Record<WalletMutationReason, [ErrorCode, HttpStatus]>` + reuse `failHttp` (recommended)
Express the reason→(code,status) map as a keyed record (compile-time exhaustive — a new reason without a
mapping is a compile error) and build the exception via `failHttp` (lift it to `common/http` since a
non-relayer surface now needs it).
- **Pros:** Compile-time exhaustiveness; deletes ~18 lines; one error-shaping mechanism across surfaces.
- **Cons:** Lifting `failHttp` to `common/` touches the relayer file (small).
- **Effort:** Small · **Risk:** Low

### Option B: Keep the switch, add an `assertNever(err.reason)` default
- **Pros:** Smallest change; turns a future unmapped reason into a compile error.
- **Cons:** Leaves the duplicated `http()` phrase ladder and the divergence from `failHttp`.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (`Record` + reuse `failHttp`).

## Implemented Solution
- Promoted `failHttp` + `REASON_PHRASE` to a shared **`src/common/http/fail-http.ts`** (added `UNAUTHORIZED`
  to the phrase map). `relayer/transfer-error-http.ts` now imports it (and re-exports for its existing
  consumers) — one error-body builder across the money + identity surfaces.
- `MeWalletsService`: replaced the non-exhaustive `switch` with a module-level
  `MUTATION_ERROR_MAP: Record<WalletMutationReason, [ErrorCode, HttpStatus]>` (a new reason without a mapping
  is now a compile error); `mapMutationError` returns `failHttp(...)`.
- Deleted the hand-rolled `http()` 5-way ternary + the `BadRequestException` special-case; all call sites
  (idempotency 409/422, replay 404, missing-key 400) use `failHttp`.

Build/lint clean; me-wallets unit (12) + e2e (8) green.

## Technical Details
Affected: new `src/common/http/fail-http.ts`; `src/modules/relayer/transfer-error-http.ts` (reuse);
`src/modules/wallets/export/me-wallets.service.ts`. BAD_REQUEST branch superseded by [[151]]; the
`IDEMPOTENCY_KEY_CONFLICT` split is [[154]].

## Acceptance Criteria
- [x] Reason→HTTP mapping is compile-time exhaustive (keyed `Record`).
- [x] Reason-phrase ladder removed in favour of the shared `failHttp` builder.
- [x] Error-body shape identical to the transfer/export surfaces (shared builder).

## Work Log
- 2026-07-15: Filed from PR #26 review — convergent finding across kieran-typescript, pattern-recognition,
  code-simplicity, and architecture agents.
- 2026-07-15: Fixed — shared `failHttp` in `common/http`, `Record`-based exhaustive mapping, ternary deleted.
