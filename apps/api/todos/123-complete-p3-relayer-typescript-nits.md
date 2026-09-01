---
status: complete
priority: p3
issue_id: 123
tags: [code-review, typescript, quality, relayer]
dependencies: []
---

# Relayer TypeScript nits: isSequenceError typed helper + resultXdr shape, branded base64/i128 types, decimal-regex dedup

## Problem Statement
Three small TypeScript-quality nits in the relayer transfer/deploy path. Each is a type-safety or
duplication cleanup, not a behavior change — the code works today, but the boundaries are looser than
they could be.

## Findings
1. **`isSequenceError` hand-cast + two call-site shapes.** `soroban-relayer.service.ts`
   `isSequenceError(result: unknown)` (~lines 456-463) hand-casts to
   `{ result?: () => { switch: () => { name?: string } } }` and compares the magic literal
   `'txBadSeq'`. Line ~408 passes `sent.errorResult`; line ~426 passes
   `(resp as { resultXdr?: unknown }).resultXdr` — two structurally different shapes into the same
   param, so the `resultXdr` branch may never actually reach `.result().switch()`. Confirm BOTH call
   sites match; narrow against `xdr.TransactionResult` via its typed accessor and hoist `'txBadSeq'` to
   a named const.
2. **No branded types at the decode boundary.** Consider opaque branded aliases (`Base64Url` vs
   `XdrBase64` vs `I128Amount`) on the port interface (`SubmitSignedTransferInput`,
   `BuildTransferResult.challenge`) so the decode boundary is compiler-enforced. Judgment call — safe
   today via the `IsBase64` / `IsBase64Url` DTO validators + a single decode site.
3. **Decimal regex duplicated.** The decimal shape `/^\d+(\.\d+)?$/` is asserted in both
   `build-transfer.dto.ts` (`@Matches`) and `amount.ts` (`DECIMAL_RE`). Optionally export one shared
   `DECIMAL_STRING_RE`.

## Proposed Solutions
- Narrow `isSequenceError` to `xdr.TransactionResult`, hoist the `'txBadSeq'` literal, and confirm the
  `resultXdr` call site actually reaches the accessor.
- Optionally introduce branded base64/i128 aliases on the port.
- Optionally share the decimal regex — but respect the codebase's duplication-over-abstraction norm.
- **Effort:** Small each · **Risk:** Low

## Recommended Action
**Resolved (with branded types deferred).** `isSequenceError` now uses the named `TX_BAD_SEQ` const and
a comment confirming both call sites pass an `xdr.TransactionResult`. The decimal regex is shared via
`DECIMAL_STRING_RE`. Branded base64/i128 aliases were considered and deferred (see ACs).

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts` (`isSequenceError` ~456-463; call sites
  ~408 `sent.errorResult`, ~426 `resultXdr`), `src/modules/relayer/relayer.service.interface.ts`
  (`SubmitSignedTransferInput`, `BuildTransferResult.challenge` ~line 41),
  `src/modules/wallets/transfer/dto/build-transfer.dto.ts` (`@Matches` ~line 25),
  `src/modules/wallets/transfer/amount.ts` (`DECIMAL_RE` ~line 13).

## Acceptance Criteria
- [x] `isSequenceError` uses a named const (`TX_BAD_SEQ`) for `'txBadSeq'`, with a comment confirming
      both call sites pass an `xdr.TransactionResult` so `.result()` is correct for each.
- [x] Branded base64/i128 aliases explicitly **deferred** (safe today — the DTO `@IsBase64`/`@IsBase64Url`
      validators + a single decode site at the service boundary keep the encodings correct; opaque
      branding is ceremony not worth the churn on a stable boundary).
- [x] Decimal regex shared (`DECIMAL_STRING_RE` exported from `amount.ts`, used by the DTO `@Matches`).

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `TX_BAD_SEQ` const + call-site comment; shared `DECIMAL_STRING_RE`. Branded types
  deferred (documented). Build + relayer/amount tests (51) green.
