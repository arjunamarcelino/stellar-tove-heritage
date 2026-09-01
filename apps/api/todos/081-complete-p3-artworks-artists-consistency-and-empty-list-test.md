---
status: complete
priority: p3
issue_id: 081
tags: [code-review, quality, consistency, testing, tov-19]
dependencies: []
---

# Minor: artworks/artists Consistency Nits + Missing Empty-List Test

## Problem Statement
The two modules are intentionally independent, but a few small inconsistencies and one test gap are
worth tidying so the pattern reads as deliberate.

## Findings
- **Constant naming drift:** artworks uses `MAX_LIST_RESULTS` (`artworks.service.ts:12`), artists uses
  `MAX_RESULTS` (`artists.service.ts:13`) for the same concept.
- **Validation asymmetry (intentional but undocumented):** artists validates `:handle` against a slug
  regex before lookup (`artists.service.ts:15,29`); artworks only length-caps `:id`
  (`artworks.service.ts:14,30`) with no charset check. This is defensible (opaque UUIDv7 id vs slug),
  but a one-line comment on the artworks side would make the asymmetry obviously intentional.
- **Empty-list AC untested:** the plan AC "empty catalog → 200 `{ data: [] }`" is behaviorally
  satisfied (`list()` of an empty set → `{ data: [] }`) but never asserted, because the mock always
  has fixtures. No test exercises the empty path.

## Proposed Solutions

### Option A: Tidy all three
- **Description:** Rename to a shared constant name (e.g. `MAX_LIST_RESULTS` both sides); add a
  one-line comment on artworks `:id` explaining the no-charset-check rationale; add one unit test per
  service asserting `list()` returns `{ data: [] }` when the repo yields an empty array.
- **Pros:** Consistent, self-documenting, closes the AC gap.
- **Cons:** Trivial churn.
- **Effort:** Small
- **Risk:** Low

### Option B: Empty-list test only
- **Description:** Just add the empty-list assertions; leave naming as-is.
- **Pros:** Minimal.
- **Cons:** Leaves the cosmetic drift.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — tidy all three.

## Implemented Solution
Applied **Option A**:
- Renamed artists' `MAX_RESULTS` → `MAX_LIST_RESULTS` (matches artworks; same concept, same name).
- Added a comment on artworks `MAX_ID_LENGTH` explaining the deliberate asymmetry: artwork ids are
  opaque (future UUIDv7), so — unlike the artist `:handle` slug — only a length bound is enforced,
  no charset check; unknown/malformed ids simply 404.
- Added an empty-list unit test to both service specs: `findAll` → `[]` yields `200 { data: [] }`.

Verified: build + lint clean; unit 200 (was 198, +2); e2e 45.

## Technical Details
- Affected: `src/modules/artworks/artworks.service.ts`, `src/modules/artists/artists.service.ts`,
  `test/unit/modules/{artworks,artists}/*.service.spec.ts`.

## Acceptance Criteria
- [x] Same constant name for the list cap in both services (`MAX_LIST_RESULTS`).
- [x] Artworks `:id` no-charset-validation rationale is commented.
- [x] A unit test asserts empty repo → `{ data: [] }` for each service.

## Work Log
- 2026-07-01: Filed from PR #19 review.
- 2026-07-01: Resolved via Option A — constant rename, `:id` rationale comment, empty-list tests. Verified build + lint + unit 200 + e2e 45.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/19
