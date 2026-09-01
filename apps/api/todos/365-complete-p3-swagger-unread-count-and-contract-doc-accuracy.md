---
status: complete
priority: p3
issue_id: 365
tags: [code-review, api-contract, swagger, docs, tov-174, pr-47]
dependencies: []
---
# unread-count route lacks a response schema + FE contract doc drifts from the DTOs (PR #47)

## Problem Statement
Two machine-readable-contract accuracy gaps for an API meant to be consumed programmatically (agent-native).

## Findings
Source: agent-native-reviewer (#2 Low, #3 Low).

1. **`GET /me/notifications/unread-count` has no `@ApiOkResponse`/DTO.**
   `src/modules/marketplace/notifications/me-notifications.controller.ts:32-36` returns an inline anonymous
   `{ count: number }` with `@ApiOperation` but no response schema, so the OpenAPI spec shows an
   empty/undocumented 200 body. A generated client can't learn the field name `count`, its type, or the cap
   semantics (100 = "100 or more").
2. **Contract doc drifts from the DTO types.**
   `docs/api-contracts/2026-08-21-tov174-rfq-notifications-api-contract.md`:
   - Example shows `"fractionCount": 100` as a JSON **number**, but `notification-response.dto.ts:32` types it
     `string` (`'100'`). The same doc elsewhere insists money fields are strings — internal inconsistency.
   - FE-integration notes reference a `channel` field "for forward-compat", but `NotificationResponseDto`
     exposes no `channel` (it is DB-only). Reads as if the field is on the response.

## Proposed Solutions
- 1: add a small `UnreadCountResponseDto { @ApiProperty({description:'capped at 100; render >=100 as "99+"'})
  count!: number }` + `@ApiOkResponse({ type: UnreadCountResponseDto })` (or at minimum an inline `schema`).
- 2: fix the example (`"fractionCount": "100"`) and remove/clarify the `channel` reference. The doc header
  already declares the DTOs are the source of truth "once built" — now that they are, reconcile these spots.
Effort: Small · Risk: None.

## Resolution (2026-08-21, complete)
- Added `dto/unread-count-response.dto.ts` (`UnreadCountResponseDto { count: number }`, `@ApiProperty` with the
  cap semantics) and annotated `GET /me/notifications/unread-count` with `@ApiOkResponse({ type:
  UnreadCountResponseDto })`; the controller + service now return the typed DTO. OpenAPI publishes the body.
- Contract doc: fixed the example `"fractionCount": 100` → `"100"` (string, i128-safe, matching the DTO) and
  clarified the `channel` note — it is a server-side column, NOT exposed on the response.
- Files: `dto/unread-count-response.dto.ts`, `me-notifications.controller.ts`, `me-notifications.service.ts`,
  `docs/api-contracts/2026-08-21-tov174-rfq-notifications-api-contract.md`. tsc + lint clean; e2e 4 green.

## Acceptance Criteria
- [ ] unread-count route publishes a typed 200 body in OpenAPI.
- [ ] Contract-doc example + field list match the DTO types (money-as-strings; no phantom `channel`).

## Work Log
- 2026-08-21: Filed from PR #47 review (agent-native-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
