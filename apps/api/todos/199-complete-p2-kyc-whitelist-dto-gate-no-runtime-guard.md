---
status: complete
priority: p2
issue_id: 199
tags: [code-review, quality, robustness, kyc, TOV-29, PR-31]
dependencies: []
---

# WhitelistStatusResponseDto: `FIELD_GATE[user.kycStatus]` has no runtime guard → opaque 500 on status drift

## Problem Statement
`FIELD_GATE` is keyed only by the 5 `KycStatus` members. The `satisfies Record<KycStatus,…>` gives
**compile-time** exhaustiveness of the map definition, but provides **zero** runtime narrowing of the
lookup. `users.kyc_status` is a `varchar(16)` + CHECK (not a native PG enum), so TypeORM hands back
whatever string the column holds without validating it against the TS enum. If a value ever falls
outside the 5 keys (manual backoffice write, a future migration that widens the CHECK before the enum
ships, replica/rolling-deploy skew), `gate` is `undefined` and the next line throws
`TypeError: Cannot read properties of undefined (reading 'whitelistedAt')` → generic 500 via
`AllExceptionsFilter`, decoupled from whatever wrote the bad value. The write path already fails-closed
against unknown status (the `submit()` exhaustive `switch` + `In([NOT_SUBMITTED])` UPDATE); the read
path has no equivalent floor.

Note: the plan's original sketch had `?? assertNever(user.kycStatus)`, but that does **not** compile
against a *total* `Record<KycStatus,…>` (the indexed access is non-`undefined` at the type level, so
`assertNever`'s arg isn't `never`). That is why it was dropped — so the fix is an explicit runtime
check, not simply restoring `?? assertNever`.

## Findings
- `src/modules/kyc/dto/whitelist-status-response.dto.ts:52-55` — `const gate = FIELD_GATE[user.kycStatus];` then `gate.whitelistedAt` with no `if (!gate)` guard. (data-integrity P2, kieran-typescript P2, architecture-strategist P3 — 3 independent agents.)
- Low probability **today** because `CHK_users_kyc_status` constrains the column, but the type `kycStatus: KycStatus` is an unchecked assertion at the ORM boundary.

## Proposed Solutions
### Option A (recommended): explicit fail-closed guard in the service before `build()`
Validate in `getWhitelistStatus` (keeps the DTO pure, no new imports there):
```ts
if (!(user.kycStatus in FIELD_GATE)) {
  throw failHttp(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, 'Unrecognized KYC status');
}
```
(or export a tiny `isKnownKycStatus` helper). **Effort: Small.**

### Option B: guard inside `build()` with `assertNever(x as never)`
`const gate = FIELD_GATE[user.kycStatus] ?? assertNever(user.kycStatus as never);` — compiles with the
`as never` cast; throws the shared "Unexpected value" error at runtime. Slightly less clean (cast), but
keeps the guarantee co-located with the gate. **Effort: Small.**

### Option C: most-restrictive fallback (never leak)
`const gate = FIELD_GATE[user.kycStatus] ?? { whitelistedAt: false, reason: false };` — a drift returns
`status` with both gated fields null instead of erroring. Fails *open on status, closed on fields*;
loses the loud signal. **Effort: Small.**

## Recommended Action
**RESOLVED (Option A/B hybrid).** Added a runtime guard inside `WhitelistStatusResponseDto.build`: the gate
lookup is annotated `| undefined` and, when absent, throws `failHttp(ErrorCode.INTERNAL_ERROR, 500,
'Unrecognized KYC status')` — a deliberate, typed 500 (logged by `AllExceptionsFilter`) instead of an opaque
`TypeError`. Kept the guard in `build()` (the owner of the gate logic) rather than the service, so the
detection lives with the map. Added a unit test exercising the unknown-status branch.

## Technical Details
- Affected: `src/modules/kyc/dto/whitelist-status-response.dto.ts:52-55`, `src/modules/kyc/kyc.service.ts:254-264`.
- Add a unit test exercising the unknown-status branch (currently untested).

## Acceptance Criteria
- [ ] An out-of-enum `kyc_status` produces a deliberate, typed error (or a fail-closed gate), never a raw `TypeError`/opaque 500.
- [ ] A unit test covers the unknown-status path.

## Work Log
- 2026-07-17: Filed from PR #31 review (data-integrity + kieran-typescript P2, architecture P3). No code changed.
- 2026-07-17: RESOLVED. `whitelist-status-response.dto.ts:52-58` runtime guard + `whitelist-status-response.dto.spec.ts` unknown-status test. build/lint/unit green. Status → complete.
