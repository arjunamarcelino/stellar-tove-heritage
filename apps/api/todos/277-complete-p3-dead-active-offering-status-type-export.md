---
status: complete
priority: p3
issue_id: 277
tags: [code-review, quality, yagni, TOV-153, PR-38]
dependencies: []
---

# Dead export: `ActiveOfferingStatus` type has zero consumers

## Problem Statement
`offering-status.constant.ts` exports both the runtime `ACTIVE_OFFERING_STATUSES` tuple (used by the
repo `In(...)`, the Swagger `enum`, and the drift-guard test) **and** a derived
`export type ActiveOfferingStatus`. The derived **type** is referenced nowhere in `src/` or `test/`.
`OfferingSummaryDto.status` deliberately stays the wider `OfferingStatus` (to avoid a cast in
`fromEntity`), so nothing narrows to `ActiveOfferingStatus`. YAGNI — remove it; re-add when a real
consumer needs the narrowed type.

## Findings
Converged across **two** reviewers:
- **kieran-typescript-reviewer (P3):** "the derived `ActiveOfferingStatus` type is referenced nowhere
  (grep confirms only its own declaration). Drop it (YAGNI)."
- **code-simplicity-reviewer (P3):** "`export type ActiveOfferingStatus` is defined but used nowhere …
  YAGNI; remove."
- Evidence: `src/modules/offerings/constants/offering-status.constant.ts:35`.

## Proposed Solutions
### Option A — Remove the unused `ActiveOfferingStatus` type export
- **Pros:** less dead surface. **Cons:** none. **Effort:** Trivial. **Risk:** None (unused).

### Option B — Keep it (document as public API for future narrowing)
- **Pros:** ready if a future M05 FR narrows to it. **Cons:** speculative; violates the repo's YAGNI
  posture. **Effort:** None.

## Recommended Action
**Option A — removed.**

## Resolution
Deleted `export type ActiveOfferingStatus` from `offering-status.constant.ts` (grep confirmed zero
consumers in `src/` and `test/`; `OfferingSummaryDto.status` intentionally keeps the wider
`OfferingStatus`). The runtime `ACTIVE_OFFERING_STATUSES` tuple is unchanged. Verified: build 0 issues.

## Technical Details
- `src/modules/offerings/constants/offering-status.constant.ts:35`

## Acceptance Criteria
- [ ] `ActiveOfferingStatus` removed (or a real consumer added); build + lint green.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38). Convergent P3 (kieran + simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
