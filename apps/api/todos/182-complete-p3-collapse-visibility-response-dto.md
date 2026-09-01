---
status: complete
priority: p3
issue_id: 182
tags: [code-review, simplicity, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Deleted `HandleHistoryVisibilityResponseDto` (structurally duplicated the request DTO,
only echoed the validated input). `HandleService.setHistoryVisibility` and `MeHandleController.setHistoryVisibility`
now return `SetHandleHistoryVisibilityDto` for both request and response — one DTO, one file removed. The wire
contract (`{ public: boolean }`) is unchanged, so the e2e (`{ public: false }`) still passes. Left the field
name `public` as-is (deliberate wire naming under `/me/handle/history`). Build clean; collectors e2e (9) green.

# Redundant visibility response DTO (echoes the request)

## Problem Statement
`SetHandleHistoryVisibilityDto` (`{ public: boolean }` + `@IsBoolean()`) and
`HandleHistoryVisibilityResponseDto` (`{ public: boolean }`) are structurally identical; the response
only echoes the validated input. The request DTO must stay (validation + Swagger example); the response
DTO is the redundant one.

Separately, the DTO field name `public` diverges from the entity/column name
`handleHistoryPublic`/`handle_history_public` (intentional wire naming — note only).

## Findings
- `src/modules/users/handle/dto/set-handle-history-visibility.dto.ts:11` — request DTO (`{ public: boolean }` + `@IsBoolean()`).
- `src/modules/users/handle/dto/handle-history-visibility-response.dto.ts:5` — response DTO (`{ public: boolean }`), structurally identical.
- `src/modules/users/handle/handle.service.ts:66` — echoes the input.

## Proposed Solutions
### Option A: Drop the response DTO; reuse the request DTO shape
- **Pros:** removes a redundant type; the request DTO already documents the shape for `@ApiResponse`.
  **Cons:** couples request/response types (acceptable — they are the same wire shape). **Effort: Small.**

### Option B: Return `204 No Content`; drop the response DTO
- **Pros:** no body to echo; removes the DTO. **Cons:** touches the e2e assertion
  `off.body).toEqual({ public: false })`. **Effort: Small.**

## Recommended Action
_(triage — Option A: a single DTO for the visibility endpoint.)_

## Technical Details
- Files: `set-handle-history-visibility.dto.ts`, `handle-history-visibility-response.dto.ts`,
  `handle.service.ts`, `me-handle.controller.ts`, `test/e2e/collectors.e2e-spec.ts`.

## Acceptance Criteria
- [x] A single DTO for the visibility endpoint (request DTO reused for both); collectors e2e green.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (code-simplicity-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
