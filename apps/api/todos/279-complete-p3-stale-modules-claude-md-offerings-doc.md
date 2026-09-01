---
status: complete
priority: p3
issue_id: 279
tags: [code-review, documentation, TOV-153, PR-38]
dependencies: []
---

# `src/modules/CLAUDE.md` offerings entry now contradicts the code

## Problem Statement
This PR changed two facts the canonical module doc (`src/modules/CLAUDE.md`, offerings entry) still
asserts:
1. It states `IOfferingRepository` is "a bare `type` alias of `IBaseRepository<Offering>` — no custom
   methods." It is now an **`interface`** with `findActiveByArtworkId`.
2. It states the non-terminal set "lives ONLY in the migration's partial-unique `WHERE`-clause." It is
   now also mirrored by the exported `ACTIVE_OFFERING_STATUSES` constant (drift-guarded by a test).

Not a runtime regression, but the module doc — a file agents/humans read to understand the offerings
repo contract — now misdescribes it. (This is `src/modules/CLAUDE.md`, NOT a `docs/plans` or
`docs/solutions` pipeline artifact, so it is in scope to update.)

## Findings
- **git-history-analyzer (P3):** "the canonical module doc now misdescribes the offerings repo
  contract."
- Evidence: `src/modules/CLAUDE.md` (offerings bullet) vs
  `src/modules/offerings/repositories/offering-repository.interface.ts` (now an interface) and
  `src/modules/offerings/constants/offering-status.constant.ts` (now exports `ACTIVE_OFFERING_STATUSES`).

## Proposed Solutions
### Option A — Update the offerings bullet in `src/modules/CLAUDE.md`
- Note `IOfferingRepository` now has `findActiveByArtworkId` (for the TOV-153 activeOffering embed) and
  that the non-terminal set is a TS constant (`ACTIVE_OFFERING_STATUSES`) mirrored + drift-guarded
  against the migration predicate.
- **Pros:** doc matches reality. **Cons:** none. **Effort:** Trivial. **Risk:** None.

## Recommended Action
**Option A — doc updated.**

## Resolution
Rewrote the offerings bullet in `src/modules/CLAUDE.md`: `IOfferingRepository` now documented as an
interface with `findActiveByArtworkId` (not a bare type alias); the non-terminal set documented as the
exported `ACTIVE_OFFERING_STATUSES` constant that the finder filters on, mirrored + `pg_indexes`
drift-guarded against the migration predicate. Also noted the shared `offering-planning.helpers.ts`
(`assertBandValid`/`resolveOfferableFloat`) consumed by both POST + preview, and the
`constants/stroops.constant.ts` leaf. Doc now matches the code.

## Technical Details
- `src/modules/CLAUDE.md` (offerings entry)

## Acceptance Criteria
- [ ] Offerings bullet reflects the interface method + the `ACTIVE_OFFERING_STATUSES` constant.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38), git-history P3.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
