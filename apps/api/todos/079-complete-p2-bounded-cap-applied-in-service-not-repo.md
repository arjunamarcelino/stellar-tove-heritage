---
status: complete
priority: p2
issue_id: 079
tags: [code-review, architecture, performance, tov-19]
dependencies: []
---

# Bounded List Cap Is Applied in the Service, Not the Repository Seam

## Problem Statement
`ArtworksService.list()` / `ArtistsService.list()` call `repo.findAll()` (which returns **all**
records) and then `.slice(0, 50)` in the service. Harmless for the in-memory mock (2-3 rows), but the
whole point of the read-repository seam is a clean swap to a TypeORM/`mv_artwork_browse` repo — and
with the current `findAll(): Promise<readonly Record[]>` signature (no `limit`), the future DB
implementation will `SELECT` the entire table into memory before the service truncates it. That is an
unbounded DB read / over-fetch, and it undermines the PR's stated "swap only the provider" goal
(TOV-189/199 would have to change the interface too).

## Findings
- `src/modules/artworks/artworks.service.ts:24` — `records.slice(0, MAX_LIST_RESULTS)` after `findAll()`.
- `src/modules/artists/artists.service.ts:26` — same (`MAX_RESULTS`).
- `src/modules/artworks/repositories/artwork-read-repository.interface.ts` /
  `artist-read-repository.interface.ts` — `findAll()` has no `limit`/paging parameter, so the cap
  cannot be pushed to the query.

## Proposed Solutions

### Option A: Add a limit to the read seam now
- **Description:** `findAll(limit: number): Promise<readonly Record[]>`. In-memory impl slices;
  future TypeORM impl does `.take(limit)`. Service passes `MAX_LIST_RESULTS`.
- **Pros:** The cap lands at the data layer; DB swap stays a one-provider change; pagination-ready.
- **Cons:** Interface gains a param now (tiny).
- **Effort:** Small
- **Risk:** Low

### Option B: Defer, document the contract
- **Description:** Keep as-is; add a comment/AC that the TOV-199 repo MUST apply `LIMIT` and that the
  interface will gain paging then.
- **Pros:** Zero change now.
- **Cons:** Relies on a future author remembering; the seam still models fetch-all.
- **Effort:** Small
- **Risk:** Medium

## Recommended Action
Option A — add a `limit` to the read seam so the cap lands at the data layer.

## Implemented Solution
Applied **Option A**:
- `IArtworkReadRepository.findAll(limit: number)` / `IArtistReadRepository.findAll(limit: number)` —
  the cap is now a repository-seam parameter (future TypeORM impl applies `LIMIT`).
- In-memory repos slice to `limit` (`ARTWORK_FIXTURES.slice(0, limit)` / artists).
- Services call `this.repo.findAll(MAX_LIST_RESULTS)` and map directly — the service-side
  `.slice(0, MAX)` is gone, so the fetch is bounded at the source, not truncated after fetching
  everything.
- Service unit specs now assert `findAll` is called with the cap (`toHaveBeenCalledWith(50)`).

## Technical Details
- Changed: both `*-read-repository.interface.ts`, both `in-memory-*.repository.ts`, both
  `*.service.ts`, and both service unit specs.

## Acceptance Criteria
- [x] The list result cap is enforceable at the repository/query layer (via the `findAll(limit)` param).
- [x] The in-memory impl returns the bounded set; unit 198 + e2e 45 stay green; build + lint clean.

## Work Log
- 2026-07-01: Filed from PR #19 review. Mock is harmless today; flagged to keep the DB swap truly one-provider.
- 2026-07-01: Resolved via Option A — `findAll(limit)` on both read seams; services pass the cap; specs assert it. Verified build + lint + unit 198 + e2e 45.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/19 · later: TOV-199 (browse/pagination).
