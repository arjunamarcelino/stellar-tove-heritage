---
status: complete
priority: p3
issue_id: 235
tags: [code-review, docs, swagger, TOV-235, PR-33]
dependencies: []
---

# DTO Swagger example wallet is an invalid 57-char StrKey; response codes not documented with @ApiResponse

## Problem Statement
Two Swagger/documentation defects. (Note: the `.env.example` contract address was checked and is a VALID 56-char StrKey — an earlier review claim of invalidity there was incorrect; only the DTO example is wrong.)

## Findings
- **Invalid DTO example (confirmed):** `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-item.dto.ts:29` → `example: 'CCNR6WXKKY42KPM2ACH5M3GET3BMIJNUEEWJYEBQKEHLDI27YT5ZLNHCP'` is **57 chars** and `StrKey.isValidContract(...) === false` (verified). It fails the field's own `@Matches(/^C[A-Z2-7]{55}$/)` + `@Validate(IsStrKeyContract)`; a dev copying the Swagger example gets a 400.
- **Missing response docs:** `backoffice-kyc-allowlist.controller.ts:30-32` declares only `@ApiOkResponse`. The handler also returns 409 (`KYC_ALLOWLIST_ALL_NOOP`, `IDEMPOTENCY_KEY_IN_FLIGHT`), 422 (config cap, mismatch), 400 (missing key / validation), 401. No machine-readable `@ApiResponse` for those.

## Proposed Solutions
- Replace the DTO example with a valid 56-char contract StrKey (reuse the valid `.env.example` value `CCNR6WXKK42...`, or the encoding spec's golden vector `CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME`). Ideally define it once as a shared constant. Effort: Small.
- Add `@ApiResponse({ status })` for 400/401/409/422 (can reference a shared error DTO), matching the fraction controller. Effort: Small.

## Recommended Action
**RESOLVED.** Replaced the invalid 57-char DTO `@ApiProperty` example with the valid 56-char address (matches `.env.example`, `StrKey.isValidContract` → true). Added `@ApiResponse` for 400/401/403/409/422 on the controller. (The `.env.example` value was re-verified as valid and left unchanged.)

## Technical Details
- Affected: `kyc-allowlist-item.dto.ts`, `backoffice-kyc-allowlist.controller.ts`.

## Acceptance Criteria
- [x] DTO example is a valid 56-char contract StrKey.
- [x] @ApiResponse added for 400/401/403/409/422.

## Work Log
- 2026-07-18: created from PR #33 review (kieran + pattern-recognition + security). `.env.example` value re-verified as valid — not included.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — valid example + response-code docs.
