---
status: complete
priority: p2
issue_id: 275
tags: [code-review, api-consistency, dto, TOV-153, PR-38]
dependencies: []
---

# Preview query params are camelCase while the sibling POST band is snake_case

## Problem Statement
`GET /artworks/:id/offering-preview` accepts the band as camelCase query params
`lowPriceStroops` / `highPriceStroops`, but the sibling write endpoint `POST /offerings`
(`CreateOfferingDto`) takes the SAME two values as snake_case `low_price_stroops` /
`high_price_stroops`. A single planning-UI flow therefore sends `lowPriceStroops` to the preview and
`low_price_stroops` to the create — the same concept, two casings, in one screen. Worth either
aligning or consciously documenting the divergence.

The local convention observed is: **request DTOs snake_case, response DTOs camelCase**
(`create-offering.dto.ts` in, `offering-response.dto.ts` out). The preview is a request (query) that
was made camelCase to match its own camelCase response — internally tidy, but inconsistent with the
sibling request DTO. (Note: the codebase is globally mixed — `create-mission.dto.ts` is camelCase — so
this is a judgment call, not a hard rule.)

## Findings
- **pattern-recognition-specialist (P2):** "the precedent to match is the sibling
  `create-offering.dto.ts` snake_case band fields. Recommend aligning the preview query to
  `low_price_stroops` / `high_price_stroops`, or explicitly documenting the deliberate divergence."
- Evidence: `offering-preview-query.dto.ts:44,57` (camelCase) vs `create-offering.dto.ts:29,35`
  (snake_case).

## Proposed Solutions
### Option A — Rename preview query params to snake_case (`low_price_stroops`/`high_price_stroops`)
- **Pros:** the band is identical across the two offering endpoints; one mental model for the UI.
- **Cons:** the preview query then mixes snake_case in with a camelCase response body; minor churn +
  test updates. **Effort:** Small. **Risk:** Low (endpoint unreleased; no external consumer yet).

### Option B — Keep camelCase, document the intentional split in the DTO + plan
- **Pros:** query-in matches response-out casing; no churn. **Cons:** the cross-endpoint mismatch for
  the UI remains. **Effort:** Trivial (a comment). **Risk:** None.

### Option C — (Larger) migrate the create DTO to camelCase too
- Out of scope for this PR; would touch TOV-152's shipped contract. Not recommended here.

## Recommended Action
**Option A — renamed to snake_case (chosen; confirmed by user 2026-08-19).**

## Resolution
`OfferingPreviewQueryDto` band fields renamed `lowPriceStroops`/`highPriceStroops` →
`low_price_stroops`/`high_price_stroops`, matching the sibling `CreateOfferingDto`, so the planning UI
sends ONE band casing to both offering endpoints. Updated the `eitherPresent` predicate, `@IsDefined`
messages, `@Matches` messages, and Swagger descriptions; the service reads `query.low_price_stroops` /
`query.high_price_stroops`; unit + query-DTO + e2e `.query({...})` inputs updated. The **response body**
(`OfferingPreviewDto`) stays camelCase (`lowPriceStroops`) per the response-DTO convention — only the
request query changed. Verified: build 0 issues, preview unit (10) + query-DTO (11) + e2e (10) green.

## Technical Details
- `src/modules/backoffice/artworks/dto/offering-preview-query.dto.ts`
- `src/modules/backoffice/offerings/dto/create-offering.dto.ts`

## Acceptance Criteria
- [ ] Casing decision recorded and applied (rename or documented divergence).
- [ ] If renamed: query DTO + preview e2e + Swagger updated; build/lint/tests green.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38). Best resolved before the Admin Console integrates the
  endpoint, so the two offering calls share one casing convention.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
