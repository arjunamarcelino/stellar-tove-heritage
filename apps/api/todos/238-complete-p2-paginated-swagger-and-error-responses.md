---
status: complete
priority: p2
issue_id: 238
tags: [code-review, swagger, openapi, api-contract, agent-native, TOV-240, PR-34]
dependencies: []
---

# List Swagger advertises a bare array (returns `{data,meta}`); error responses (404/400/401) undocumented

## Problem Statement
`GET /artworks` returns `PaginatedResponseDto<ArtworkListItemDto>` (a `{ data, meta }` envelope), but `@ApiOkResponse({ type: ArtworkListItemDto, isArray: true })` advertises a top-level `ArtworkListItemDto[]`. A client generating types from the spec gets the wrong list model (no `data`/`meta`, no `PaginationMeta`). Additionally, neither read endpoint documents its failure contract: `getArtwork` can 404 (unknown/soft-deleted) and 400 (`ParseUUIDPipe`); `listArtworks` can 400 (out-of-enum `status`, bad `page`/`limit`); both can 401 behind `BackofficeGuard`. None are declared, so a programmatic client can't see the `ErrorCode` envelope or which statuses to handle.

## Findings
Flagged by agent-native-reviewer (P2 #1/#2/#3) and kieran-typescript-reviewer (P2).
- `src/modules/backoffice/artworks/backoffice-artworks.controller.ts:42-44` (list `@ApiOkResponse` isArray), `:50-52` (detail).
- `src/common/dto/paginated-response.dto.ts:18` — `data` has no `@ApiProperty`, so even a `$ref` would omit it without an `allOf` override.
- **Pre-existing convention:** `missions`, `stages`, `admins`, `users`, `submissions`, `files` all do the identical `isArray:true` on a paginated envelope — so this PR is *consistent* with neighbors, not worse. But it's inaccurate everywhere, and new endpoints are a good place to set the correct pattern.
- The codebase already has the idiom to mirror: `src/common/decorators/api-collection-response.decorator.ts` (`ApiExtraModels` + `allOf`/`getSchemaPath`) for the sibling `CollectionResponseDto`.

## Proposed Solutions
1. **Add a reusable `@ApiPaginatedResponse(Model)` decorator** mirroring `ApiCollectionResponse` (allOf of `$ref(PaginatedResponseDto)` + `{ properties: { data: { type:'array', items: $ref(Model) } } }`), add `@ApiProperty()` to `PaginatedResponseDto.data`, and apply it to the list route. Pays down debt for every future backoffice list. Effort: Medium. Risk: low (docs-only).
2. Add `@ApiNotFoundResponse`/`@ApiBadRequestResponse`/`@ApiUnauthorizedResponse` (typed to the shared error envelope) to both routes — ideally a shared decorator so all backoffice routes document guard failures uniformly. Effort: Small–Medium.
3. Leave as-is to stay consistent with the 7 existing endpoints; file a repo-wide follow-up instead. Risk: spec stays inaccurate; clients hand-patch.

## Recommended Action
**RESOLVED** (Solution 1 + 2, **full sweep** per user).
1. Added `@common/decorators/api-paginated-response.decorator.ts` (`ApiPaginatedResponse`, mirroring `ApiCollectionResponse`) — renders `{ data: Model[], meta: PaginationMeta }` via `allOf`.
2. Applied it to **all 8** endpoints returning `PaginatedResponseDto<>` (backoffice missions/stages/admins/users/submissions/files/artworks + public submissions), replacing the inaccurate `@ApiOkResponse({ isArray: true })`.
3. Added typed error responses (`@ApiBadRequestResponse`/`@ApiNotFoundResponse`/`@ApiUnauthorizedResponse`) to the two artwork routes.
Verified with a throwaway Swagger-generation smoke test: the artworks list `200` schema is an `allOf` envelope (not `type: array`), `PaginatedResponseDto` is in `components.schemas`, and the detail route documents `404`/`400`.

## Technical Details
- Docs-only; no runtime change. Consider scoping the `@ApiPaginatedResponse` + error-response decorators repo-wide rather than one endpoint.

## Acceptance Criteria
- [ ] List endpoint's OpenAPI schema reflects `{ data: ArtworkListItemDto[], meta: PaginationMeta }`.
- [ ] `getArtwork` documents 404 + 400; both routes document 401; error body typed to the `ErrorCode` envelope.
- [ ] `/docs/backoffice` renders the corrected shapes.

## Work Log
- 2026-07-18: created from PR #34 review (agent-native, kieran-typescript).
- 2026-07-18: RESOLVED — new ApiPaginatedResponse decorator applied to all 8 paginated endpoints + error responses on artwork routes. Build + whole-repo lint clean; app-boot e2e (19) green; Swagger-generation smoke check passed (allOf envelope, PaginatedResponseDto in components, 404/400 on detail).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
- Pattern to mirror: `src/common/decorators/api-collection-response.decorator.ts`
