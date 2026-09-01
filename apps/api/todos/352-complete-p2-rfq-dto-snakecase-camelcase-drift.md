---
status: complete
priority: p2
issue_id: 352
tags: [code-review, quality, api-contract, tov-172]
dependencies: []
---
# RFQ DTOs use snake_case while every sibling authenticated surface uses camelCase (PR #46)

## Problem Statement
`CreateRfqDto` and `RfqResponseDto` use snake_case field names (`artwork_id`, `fraction_count`,
`max_price_per_fraction_stroops`, `collector_sub`, `fraction_contract_id`, `expires_at`, `created_at`,
`balance_warning`). The sibling authenticated surfaces on the same `api/v1` tree emit camelCase:
`BidResponseDto` (`offeringId`, `escrowAmountStroops`, `chainBidId`, `createdAt`), `HoldingDto`
(`artworkId`, `tokenContract`), and `SubmitBidDto`'s request body. There is no global snake_case interceptor —
the field names ARE the literal wire shape — so `POST /marketplace/rfqs` returns snake_case while
`/offerings/:id/bids` and `/me/holdings` return camelCase. The `TOV-172-rfq-create.md` FE contract mandates
snake_case, but that doc is DRAFT and self-states the backend DTOs are authoritative once merged.

## Findings
Source: pattern-recognition-specialist (P2). The request body snake_case mirrors the issue's literal spec
(`{ artwork_id, fraction_count, max_price_per_fraction_stroops, expiry_hours }`), so the DTO followed the ticket —
but the response casing is the real inconsistency, and this will propagate to FR-06.02+ if unaddressed.

- `src/modules/marketplace/rfqs/dto/create-rfq.dto.ts`
- `src/modules/marketplace/rfqs/dto/rfq-response.dto.ts`
- Precedent: `src/modules/offerings/bids/dto/bid-response.dto.ts`, `src/modules/fractionalization/me/dto/holding.dto.ts`

## Proposed Solutions
### Option A — Confirm snake_case as a deliberate, documented exception
- Description: Keep snake_case (the issue spec mandates it for the RFQ surface); record it explicitly in the
  module CLAUDE.md / FE contract so it isn't mistaken for drift and is applied consistently across M06.
- Pros: Honors the ticket + the FE contract already written; no code change; one decision covers all of M06.
- Cons: Two casings coexist on `api/v1`; FE must special-case marketplace responses.
- Effort: Small (doc only)
- Risk: Low

### Option B — Flip to camelCase (house default)
- Description: Rename response (and optionally request) fields to camelCase; update the FE contract + e2e assertions.
- Pros: One casing across `api/v1`; matches every other authenticated surface.
- Cons: Diverges from the issue's literal body spec; FE contract rewrite; the request body then differs from the ticket.
- Effort: Medium
- Risk: Low

## Recommended Action
Option B — flip request + response to camelCase (house default). Approved 2026-08-21.

## Resolution
Flipped both the request (`CreateRfqDto`) and response (`RfqResponseDto` + `BalanceWarningDto`) to camelCase
so `/marketplace/rfqs` matches every other authenticated `api/v1` surface (`/bids`, `/me/holdings`):
`artworkId`, `fractionCount`, `maxPricePerFractionStroops`, `expiryHours`; response adds `collectorSub`,
`fractionContractId`, `expiresAt`, `createdAt`, `balanceWarning { requiredStroops, availableStroops }`.
Updated `RfqBalanceAdvisor` (warning keys), `RfqsService` (dto field access + idempotency fingerprint keys),
the FE contract doc (`docs/api-contracts/TOV-172-rfq-create.md` — request/response tables, JSON examples, TS
types, curl), and all three test suites. This diverges from the issue's literal snake_case body spec — a
deliberate call to keep the whole `api/v1` tree consistent. Verified: build 0, lint clean, RFQ unit 43/43,
integration 6/6, e2e 10/10.

## Technical Details
- If Option B, both the DTOs and `docs/api-contracts/TOV-172-rfq-create.md` + `marketplace-rfq.e2e-spec.ts` change.

## Acceptance Criteria
- [ ] Casing decision recorded (exception vs flip) and reflected in the FE contract + module docs.
- [ ] If flipped, DTOs/tests/contract updated and green.

## Work Log
- 2026-08-21 — Filed from PR #46 review (pattern-recognition-specialist).

## Resources
- PR #46; `docs/api-contracts/TOV-172-rfq-create.md`.
