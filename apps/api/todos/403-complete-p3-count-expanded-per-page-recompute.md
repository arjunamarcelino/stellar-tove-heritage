---
status: complete
priority: p3
issue_id: 403
tags: [code-review, tov-191, pr-51, performance]
dependencies: []
---
# `additionalEventsCount` (countExpanded) recomputed on every paginated page

## Resolution (2026-08-24) — Option A
`TimelineService.getTimeline` now computes `countExpanded` only when there is no `cursor` (first page); paginated pages return `additionalEventsCount: 0`. Removes the redundant index-only query on every deep-scroll page. Updated the FE contract to state the count is first-page-only (read once from page 1). Did NOT parallelize page+count (Option B) — the count now runs on the first page only, where the marginal latency win is negligible and the sequential form keeps the 404-gate ordering obvious.
- Files: `src/modules/timeline/timeline.service.ts`, `docs/api-contracts/2026-08-24-tov191-artwork-timeline-api-contract.md`.
- Tests: unit asserts `countExpanded` NOT called + `additionalEventsCount === 0` on a cursor page. Verified 8 unit / 11 e2e pass.

## Problem Statement
`additionalEventsCount` is a whole-artwork, page-independent teaser figure, but the service gates its computation on `expand` only — **not on `cursor`**. So `countExpanded(id)` runs an extra DB round-trip on *every* default-view page (page 2, 3, 4…) even though the value is invariant across a scroll of the same artwork. A client scrolling a long timeline doubles the query count it needs. The query itself is a cheap index-only scan, so this is low-severity, but it's free to avoid. Additionally, on the first page, `page()` and `countExpanded()` have no data dependency yet run serially — they could be parallelized to shave one round-trip's latency.

## Findings
- `src/modules/timeline/timeline.service.ts:40` — `additionalEventsCount = query.expand ? 0 : await this.repo.countExpanded(id)` (no `!query.cursor` gate).
- `src/modules/timeline/timeline.service.ts:33,40` — `page` then `countExpanded` run sequentially.
- Performance-oracle confirmed the index fit is otherwise clean (IDX_ate_tier / IDX_ate_all, row-value keyset as Index Cond, count is index-only). No P1/P2.

## Proposed Solutions
### Option A — Only compute the count on the first page (Recommended)
`const additionalEventsCount = (query.expand || query.cursor) ? 0 : await this.repo.countExpanded(id)`. Return 0 (or omit) on subsequent pages. Confirm the FE contract treats a first-page-only count as expected (it already labels it a "there's more behind expand" hint).
- Pros: removes the recompute on deep scroll; trivial. Cons: subtle contract note — count is 0 on pages ≥2 (FE should read it from page 1).
- Effort: Small · Risk: Low.

### Option B — Parallelize page + count with `Promise.all` on the first page
Keep `existsVisibleArtwork` first (404 gate, no oracle), then `Promise.all([page, countExpanded])`. Combine with Option A for max effect.
- Pros: lower first-page latency. Cons: marginal; shares the pool (max 20) — negligible at 30/min throttle.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `timeline.service.ts` only. May need a one-line note in the FE contract (`docs/api-contracts/2026-08-24-tov191-artwork-timeline-api-contract.md`) if count becomes first-page-only.

## Acceptance Criteria
- [ ] `countExpanded` is not called on paginated (cursor present) requests.
- [ ] FE contract reflects the first-page-only semantics if adopted.

## Work Log
- 2026-08-24: Filed from PR #51 review (performance-oracle, low).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
