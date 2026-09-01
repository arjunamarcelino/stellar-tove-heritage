---
status: complete
priority: p2
issue_id: 217
tags: [code-review, correctness, ux, TOV-233, PR-32]
dependencies: []
---

# GET :id/fractionalization returns 404 for a terminally-failed deploy (indistinguishable from never-requested)

## Problem Statement
The status read filters to active statuses only, so a `failed` deploy row is invisible. An admin who watched a deploy fail gets a 404 ARTWORK_NOT_FOUND instead of a failed-status card — indistinguishable from an artwork that was never fractionalized.

## Findings
- `src/modules/backoffice/artworks/backoffice-artworks.service.ts` ~lines 172-178 uses `contracts.findActiveByArtworkId`.
- `fraction-contract.repository.ts` ~lines 19-23 filters `status IN ('deploying','deployed')` → a `failed` row is invisible.
- After `latchFailed`, `getStatus` returns 404 ARTWORK_NOT_FOUND, so an admin who watched it fail gets a 404, not a failed status card.

## Proposed Solutions
### Option A (recommended): add a failed-inclusive latest lookup for the status read
- Add `findLatestByArtworkId` (drop the status filter, `ORDER BY created_at DESC LIMIT 1`) for the status read so it surfaces failed/historical rows.
- Keep `findActiveByArtworkId` for the dedup/insert path.
- Note: neither partial index covers `status='failed'`, but the failed-inclusive lookup falls back to `IDX_fraction_contracts_artwork` (`WHERE deleted_at IS NULL`), which is adequate at one-to-few rows per artwork — do NOT add a status-only predicate expecting index support.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A).** Added `findLatestByArtworkId` (drops the status filter, `ORDER BY created_at DESC LIMIT 1`, `deleted_at IS NULL`) and pointed `getStatus` at it, so a terminally-`failed` deploy now returns its `failed` status card instead of a 404 that was indistinguishable from never-requested. `findActiveByArtworkId` is retained for the dedup/insert guard. The failed-inclusive read falls back to `IDX_fraction_contracts_artwork` (`WHERE deleted_at IS NULL`), adequate at one-to-few rows per artwork; no status-only predicate was added.

## Technical Details
- Affected: `src/modules/backoffice/artworks/backoffice-artworks.service.ts` (~lines 172-178); `src/modules/fractionalization/deploy/fraction-contract.repository.ts` (~lines 19-23).
- Dedup/insert path must keep using the active-only lookup; only the status read changes.

## Acceptance Criteria
- [ ] `getStatus` returns a failed-status result (not 404) for a terminally-failed deploy.
- [ ] A never-requested artwork still returns 404, distinguishable from failed.
- [ ] Dedup/insert path continues to use `findActiveByArtworkId`.
- [ ] No status-only index predicate is added; failed-inclusive lookup relies on `IDX_fraction_contracts_artwork`.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — getStatus reads the latest row incl. failed; build green.
