---
status: complete
priority: p2
issue_id: 362
tags: [code-review, api-contract, swagger, tov-174, pr-47]
dependencies: []
---
# GET /me/notifications documents a bare array in OpenAPI but returns a paginated envelope (PR #47)

## Problem Statement
The list endpoint returns `PaginatedResponseDto<NotificationResponseDto>` (envelope `{ data: [...], meta: {
page, limit, total, totalPages } }`) but is annotated `@ApiOkResponse({ type: NotificationResponseDto, isArray:
true })`, which publishes the response in the generated OpenAPI spec as a **bare top-level array**. An FE/agent
that generates a client from `/docs/public` would deserialize `response[0].id` (undefined — the real path is
`response.data[0].id`) and never discover `meta.totalPages` for pagination. This is a confidently *wrong* doc,
worse than a missing one, and it diverges from the house convention.

## Findings
Source: agent-native-reviewer (Medium), kieran-typescript-reviewer (#3), pattern-recognition-specialist
(MEDIUM) — triple-confirmed.
- `src/modules/marketplace/notifications/me-notifications.controller.ts:24` — the `@ApiOkResponse({ type,
  isArray: true })` line.
- The codebase already has the exact fix, and its JSDoc calls out this precise bug:
  `src/common/decorators/api-paginated-response.decorator.ts:6-8`.
- Every other paginated list uses `@ApiPaginatedResponse(Dto)` (backoffice offerings/artworks/users/admins,
  missions, stages, submissions). `isArray:true` is only correct for genuinely-array endpoints like
  `me/holdings` (returns `HoldingDto[]`, no envelope).

## Proposed Solutions
### Option A — Use the shared decorator (Recommended)
- Description: Replace line 24 with `@ApiPaginatedResponse(NotificationResponseDto)`.
- Pros: One-line; matches every other paginated endpoint; emits the correct envelope schema.
- Cons: None.
- Effort: Small
- Risk: None

## Recommended Action
Option A — use the shared `@ApiPaginatedResponse` decorator.

## Resolution (2026-08-21, complete)
Replaced `@ApiOkResponse({ type: NotificationResponseDto, isArray: true })` on `GET /me/notifications` with
`@ApiPaginatedResponse(NotificationResponseDto)` (imported from `@common/decorators/api-paginated-response.decorator`).
The OpenAPI now correctly documents the `{ data, meta }` envelope, matching every other paginated endpoint.
Swagger-metadata only — no behavior change (the e2e already asserts the envelope shape and stays green).
File: `me-notifications.controller.ts`. tsc + lint clean.

## Technical Details
- Affected: `me-notifications.controller.ts` (import `@ApiPaginatedResponse` from `@common/decorators/...`).
- No behavior change — Swagger metadata only.

## Acceptance Criteria
- [ ] The generated OpenAPI for `GET /api/v1/me/notifications` shows the `{ data, meta }` envelope, not a bare array.
- [ ] Import + decorator match the sibling paginated controllers.

## Work Log
- 2026-08-21: Filed from PR #47 review (agent-native + typescript + pattern, MEDIUM ×3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
- FE contract: docs/api-contracts/2026-08-21-tov174-rfq-notifications-api-contract.md
