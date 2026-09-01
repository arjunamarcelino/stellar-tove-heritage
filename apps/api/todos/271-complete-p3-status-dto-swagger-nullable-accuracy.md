---
status: complete
priority: p3
issue_id: 271
tags: [code-review, quality, swagger, openapi, TOV-241, PR-37]
dependencies: []
---

# Status DTO: `@ApiPropertyOptional` on always-present nullable fields + `updatedAt` doc gaps

## Problem Statement
`KycAllowlistStatusResponseDto` returns a **fixed** shape — all keys always present, some `null`. But `lastAction`/`lastTxHash`/`lastLedger`/`updatedAt` use `@ApiPropertyOptional`, which emits `required: false` in OpenAPI, signalling the key *may be absent*. That contradicts the actual contract (the e2e `toEqual` asserts every key is always present) and makes generated client types mark fields optional (`field?:`) rather than required-nullable. Separately, `updatedAt` is omitted from the class JSDoc's provenance list and has no `@ApiProperty` example while its siblings do.

## Findings
Flagged by **pattern-recognition-specialist (P3)** and **kieran-typescript-reviewer (P3)**.
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-status-response.dto.ts:19,22,25,28` — `@ApiPropertyOptional`.
- Same file `:5-11` (JSDoc omits `updatedAt`), `:28-29` (no example).
- Precedent for required+nullable: `whitelist-status-response.dto.ts:37` (`@ApiProperty({ type: String, format: 'date-time', nullable: true })`), `holding.dto.ts:31`.
- **Countervailing precedent:** the same-module sibling `kyc-allowlist-response.dto.ts:15-19` uses `@ApiPropertyOptional({ nullable: true })` on always-set fields — so the PR is internally consistent with its own module; the plan flagged this as a conscious tradeoff (consistency vs precision).

## Proposed Solutions
1. **Switch to `@ApiProperty({ nullable: true })`** (keep `enum:` on `lastAction`) for the four fields; add `updatedAt` to the JSDoc list + an ISO example. Pros: precise "required + nullable" OpenAPI, matches the status-card precedent, correct generated client types. Cons: diverges from the same-module `kyc-allowlist-response.dto` style (which arguably should also be fixed); Effort: Small.
2. **Keep `@ApiPropertyOptional`, add only the `updatedAt` JSDoc/example** — minimal, preserves same-module consistency. Pros: least churn. Cons: leaves the required-vs-optional imprecision; Effort: trivial.

## Recommended Action
**RESOLVED — Solution 2 (keep `@ApiPropertyOptional`, fix the `updatedAt` docs; user-confirmed).** The nullable
fields keep `@ApiPropertyOptional({ nullable: true })` to match the same-module `KycAllowlistResponseDto` (the
plan's conscious consistency choice); a note in the DTO JSDoc records that `@ApiProperty({ nullable: true })`
would be strictly more precise, so the tradeoff is explicit rather than accidental. `updatedAt` is now listed
in the class JSDoc provenance set and carries an ISO `example`.

## Technical Details
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-status-response.dto.ts` (JSDoc + `updatedAt` `@ApiPropertyOptional` example). Sibling `kyc-allowlist-response.dto.ts` intentionally left unchanged (consistency preserved).

## Acceptance Criteria
- [x] Nullable annotation decision recorded (keep Optional; precise-alternative noted) and consistent within the module.
- [x] `updatedAt` appears in the DTO JSDoc provenance list and has an example.
- [x] Build clean.

## Work Log
- 2026-08-18: created from PR #37 review (pattern-recognition-specialist + kieran-typescript-reviewer, both P3).
- 2026-08-18: RESOLVED (user chose keep-Optional) — added `updatedAt` to JSDoc + example; documented the ApiProperty-nullable tradeoff. Build green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
