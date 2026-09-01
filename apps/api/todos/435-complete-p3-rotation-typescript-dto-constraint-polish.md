---
status: complete
priority: p3
issue_id: 435
tags: [code-review, tov-33, pr-56, typescript, dto, quality]
dependencies: []
---
# Rotation P3 TypeScript / DTO / constraint polish (bundled)

## Resolution (2026-08-27)
**Applied:**
- **#1** `custodyEntry(...)` now annotated `: RegistryEventInsert` — the contract is enforced at the definition.
- **#2** `RotationReadState` derives from a single `ROTATION_READ_STATES as const` tuple that also feeds the
  `@ApiProperty` enum (no hand-repeated literals).
- **#3** `SubmitRotateTransferItemResultDto.errorCode` typed `ErrorCode` (was `string`) + `@ApiProperty enum: ErrorCode`.
- **#4** added `@MinLength(1)` to `clientDataJSON` for both-ends symmetry with its siblings.
- **#6** `CancelRotateTransferResponseDto.create` now takes the object-arg `{ canceledId }` + `Object.assign`
  (matches every other response DTO); call site updated.

**Consciously declined:**
- **#5 `CHK_wrti_amount` `'00'` admissibility** — not reachable (`balancesOf` returns canonical i128 with no
  leading zeros); tightening the regex would need a migration ALTER on an already-applied table for an
  unreachable case. Left as-is (registry side already uses the stronger numeric `> 0`).

Build 0 issues; rotation unit green.
## Problem Statement
Non-blocking type-safety and convention polish from the PR #56 review (kieran-typescript-reviewer,
pattern-recognition-specialist, data-integrity-guardian). No `any` and no defect — these are drift-guards. Verdict
from the TS review: passes the type-safety bar.

## Findings
1. **`custodyEntry` has no explicit return type** (`wallet-rotation.service.ts:547-566`). It returns an inferred
   literal that happens to satisfy `RegistryEventInsert`; a future field drift surfaces at the two call sites, not
   here. Annotate `private custodyEntry(...): RegistryEventInsert`. (the one spot where a precise type is available
   but not asserted.)
2. **`RotationReadState` breaks the `as const` single-source pattern**
   (`dto/rotate-transfer-status-response.dto.ts:5,17`). The union and the Swagger `enum: ['none',…]` re-type the
   same 5 literals by hand and can drift (no `assertNever` ties them). Introduce
   `ROTATION_READ_STATES = [...] as const`, derive the type, and spread into `@ApiProperty`. Combines with dropping
   parent `'failed'` (todo 434 #2).
3. **`errorCode` widened to `string`** on `SubmitRotateTransferItemResultDto.errorCode`
   (`submit-rotate-transfer-response.dto.ts:16`) + `markItemFailed(errorCode: string)` — every value assigned is an
   `ErrorCode` member. Typing these `ErrorCode` preserves the precise union at zero cost. (The `last_error_code`
   column is legitimately `varchar`.)
4. **`clientDataJSON` lacks a `@MinLength`** (`submit-rotate-transfer.dto.ts:27-30`) while siblings bound both ends.
   Cosmetic symmetry (`@IsBase64Url` likely rejects empty).
5. **`CHK_wrti_amount` admits zero-equivalent strings.** `CHECK (amount_scaled ~ '^[0-9]+$' AND amount_scaled <> '0')`
   (migration 053) passes `'00'`/`'007'` (literal-string compare). Not reachable today (`balancesOf` returns
   canonical i128), but the registry side uses the stronger numeric `> 0` — `^[1-9][0-9]*$` gives parity.
   (data-integrity P3)
6. **`CancelRotateTransferResponseDto.create(canceledId: string)` is positional** while every other response DTO in
   the PR uses `create(data: {…})` + `Object.assign` (`dto/rotate-transfer-status-response.dto.ts`). Single field,
   so it works — conventional form is the object-arg signature. (patterns P3)

## Recommended Action
(blank — triage). #1 and #2 are the drift-guards worth landing.

## Resources
- PR #56; reviewers: kieran-typescript-reviewer, pattern-recognition-specialist, data-integrity-guardian.
