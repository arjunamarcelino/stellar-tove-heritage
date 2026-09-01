---
status: complete
priority: p2
issue_id: 421
tags: [code-review, tov-31, pr-54, api, openapi, swagger, agent-native]
dependencies: []
---
# Beneficiary routes have no `@ApiOkResponse` (response DTOs absent from the spec) and POST is documented 201 not 200

## Resolution (2026-08-26)
Option A. Added `@ApiOkResponse({ type: BeneficiaryResponseDto })` to `getMine`/`set`/`remove` — this both
emits `BeneficiaryResponseDto`/`BeneficiaryDto`/`BeneficiaryNoticeDto` into `components.schemas` AND pins
POST to 200 (overriding the `@Post` default 201 that Swagger documented despite `@HttpCode(200)`). Added
class-level `@ApiUnauthorizedResponse` (401) + `@ApiTooManyRequestsResponse` (429) and `@ApiBadRequestResponse`
(400) on POST. Made `notice.code` a machine-readable enum (`enum: Object.values(BENEFICIARY_NOTICE).map(n => n.code)`)
and added `format: 'email'` to the email field. `me-beneficiary.controller.ts`, `dto/beneficiary-response.dto.ts`,
`dto/set-beneficiary.dto.ts`. Build 0 issues; lint clean; beneficiary e2e 5/5 green.

## Problem Statement
None of the three `me/beneficiary` routes carry a response decorator, so `@nestjs/swagger` (which does NOT read the TS `Promise<BeneficiaryResponseDto>` return type) generates operations with **no response body schema**, and `BeneficiaryResponseDto`/`BeneficiaryDto`/`BeneficiaryNoticeDto` are **never emitted into `components.schemas`** — the entire `{ beneficiary, notice }` contract is absent from the machine-readable spec. Separately, `@HttpCode(HttpStatus.OK)` is correct (200 even on first create) but Swagger ignores it and documents the default **201** for a `@Post`, so the spec advertises a status the endpoint never returns. A machine/agent consumer relying on `/docs/public` JSON gets an incomplete and partly-wrong picture; today only the human-written FE contract markdown carries the shapes.

## Findings
1. **No response schema on any route.** `src/modules/users/beneficiary/me-beneficiary.controller.ts:21,28,37` — no `@ApiOkResponse({ type: BeneficiaryResponseDto })`. The sibling `src/modules/backoffice/users/backoffice-users.controller.ts:57,66,71` shows the in-repo precedent this omits. (agent-native-reviewer **P2**)
2. **POST documented 201, returns 200.** `me-beneficiary.controller.ts:28-29` — an explicit `@ApiOkResponse(...)` also overrides the default 201. (agent-native **P2**)
3. **P3 Swagger nits:** `notice.code` is a stable closed enum but typed as free `string` (`beneficiary-response.dto.ts:44`) — add `enum: ['KYC_REQUIRED_FOR_TRANSFER']`; 400/401/429 not annotated (`@ApiBadRequestResponse`/`@ApiUnauthorizedResponse`/`@ApiTooManyRequestsResponse`); `email` lacks `format: 'email'` (`set-beneficiary.dto.ts:40`).

## Proposed Solutions
### Option A — Annotate responses (Recommended)
Add `@ApiOkResponse({ type: BeneficiaryResponseDto })` to `getMine`/`set`/`remove` (fixes both the missing schema AND the 201→200 mis-declaration), add `enum` to `notice.code`, `format:'email'` to the DTO, and the 400/401/429 response decorators. Effort: Small · Risk: none (docs only).
### Option B — Minimal
Only add `@ApiOkResponse` (closes the two P2s); defer the P3 nits. Effort: Trivial.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/beneficiary/me-beneficiary.controller.ts`, `dto/beneficiary-response.dto.ts`, `dto/set-beneficiary.dto.ts`.
- Verify the DTO classes appear in `/api/v1/docs/json` `components.schemas` after the fix.

## Acceptance Criteria
- [ ] `BeneficiaryResponseDto` (+ nested) appears in the public OpenAPI schema; all three ops show the `{ beneficiary, notice }` response.
- [ ] POST documents 200 (not 201).

## Work Log
- 2026-08-26: Filed from PR #54 agent-native review (two P2 completeness/accuracy gaps + P3 nits).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
- Precedent: `backoffice-users.controller.ts` `@ApiOkResponse({ type: UserResponseDto })`
