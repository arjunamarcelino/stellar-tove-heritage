---
status: complete
priority: p3
issue_id: 348
tags: [code-review, quality, typescript, tov-165]
dependencies: []
---
# `resolveOfferableFloat` snapshot-source symmetry: also return `totalSupply` (PR #45)

## Problem Statement
`BackofficeOfferingsService.create` snapshots the 3 supply/retention columns onto the offering. The two retention
values come from `resolveOfferableFloat`'s narrowed return fields, but `totalSupplyStroops` reads `fc.totalSupply`
directly. It is type-safe (`total_supply` is NOT NULL, no narrowing needed), but the source is asymmetric and the
CLAUDE.md phrasing "snapshots … from `resolveOfferableFloat`" is slightly imprecise since `totalSupply` isn't among
the helper's returned fields.

## Findings
Sources: kieran-typescript-reviewer (minor note), architecture-strategist (P3).

- `src/modules/offerings/offering-planning.helpers.ts:38-71` — `resolveOfferableFloat` returns `contract`,
  `publicFloat`, `artistRetentionAmount`, `treasuryRetentionAmount` but not `totalSupply`.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:132-138` — writes
  `totalSupplyStroops: fc.totalSupply` (direct) alongside the two narrowed retention fields.
- Purely cosmetic; both reviewers explicitly said not to block on it.

## Proposed Solutions
### Option A — Return `totalSupply` from the helper
- Description: Add `totalSupply: fc.totalSupply` to `resolveOfferableFloat`'s return; the service then sources all
  three snapshot inputs from one place. Optionally tighten the CLAUDE.md phrasing.
- Pros: One narrowed source for all 3 snapshot values; matches the doc wording.
- Cons: Trivial churn; `totalSupply` needs no narrowing so the symmetry is aesthetic.
- Effort: Small
- Risk: Low

### Option B — Leave as-is
- Description: Keep `fc.totalSupply` direct; optionally reword CLAUDE.md to "from the resolved fraction_contract".
- Pros: Zero code churn.
- Cons: Minor source asymmetry remains.
- Effort: None (or a doc word)
- Risk: None

## Recommended Action
Option A (return `totalSupply` from the helper) — user-confirmed 2026-08-21.

## Resolution
Applied Option A. `resolveOfferableFloat` (`offering-planning.helpers.ts`) now returns `totalSupply: fc.totalSupply`
alongside the two narrowed retention fields; `BackofficeOfferingsService.create` destructures `totalSupply` and
writes `totalSupplyStroops: totalSupply` (was `fc.totalSupply` direct) so all three planning-snapshot inputs flow
from one source. Updated the `resolveOfferableFloat` positive unit test to expect the new field. Build 0, unit 875 green.

## Technical Details
- Files: `src/modules/offerings/offering-planning.helpers.ts`,
  `src/modules/backoffice/offerings/backoffice-offerings.service.ts`, `src/modules/CLAUDE.md` (wording).

## Acceptance Criteria
- [ ] Decision recorded; if Option A, the helper returns `totalSupply` and the service consumes it; unit/e2e green.

## Work Log
- 2026-08-21: Filed from PR #45 review (typescript + architecture P3, non-blocking). Not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/45
