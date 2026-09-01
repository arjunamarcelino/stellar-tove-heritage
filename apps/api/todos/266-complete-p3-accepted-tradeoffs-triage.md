---
status: complete
priority: p3
issue_id: 266
tags: [code-review, simplicity, architecture, TOV-152, PR-36]
dependencies: []
---

# Review-accepted trade-offs — confirm won't-fix (one triage decision)

## Problem Statement
Several reviewers flagged items where the recommendation was "keep / accept" — mild YAGNI or pre-existing/systemic patterns that match the codebase. Grouped here for a single triage sign-off so they aren't re-flagged on the next review. Each has a concrete note in case product/eng disagrees.

## Findings
1. **Throttle is per-IP, not per-admin** (security-sentinel P3) — `backoffice-offerings.controller.ts` `@Throttle` falls back to IP for admin tokens (the identity throttler verifies with the *user* secret). Idempotency + the unique index already prevent duplicate creates, so it's a coarse flood backstop. The controller comment already documents this. Action only if per-admin limiting is wanted (make the throttler backoffice-secret-aware — a platform-wide change).
2. **Redundant artwork read** (performance-oracle P3) — `artworks.findOneById` at step 4a is logically subsumed by `findActiveByArtworkId` at 4b, but is retained to distinguish `404 ARTWORK_NOT_FOUND` from `409 OFFERING_ARTWORK_NOT_FRACTIONALIZED`. Distinct error semantics justify it; one extra indexed PK lookup on a low-QPS path. Keep.
3. **Empty repository layer** (simplicity P3; architecture confirms warranted) — `IOfferingRepository = IBaseRepository<Offering>` + token + class with zero custom methods; the only type-alias repo interface in the codebase. Kept for the mandated repository-pattern uniformity and as a stable seam for M05 lifecycle-transition methods. Keep.
4. **`computePublicFloat` extracted for a single caller** (simplicity P3; architecture: correctly homed) — co-locates retention math with `FractionContract` and is unit-testable; one caller today. Keep.
5. **`OfferingsModule` exports `TypeOrmModule` but no consumer injects a raw `Offering` repo** (architecture P3) — vestigial re-export, faithful to the fractionalization template. Optional: drop `TypeOrmModule` from `exports`. Low urgency.
6. **`offering-status.constant.ts` full 6-state lifecycle / response advertises all 6** (simplicity P3) — SSOT for the entity type + migration CHECK vocabulary; the create endpoint always returns `planned`. Keep the constant; optionally narrow the response `@ApiProperty` description. Cosmetic.
7. **Active-set vocabulary lives only in raw SQL** (data-integrity P3) — the non-terminal set `{planned,approved,opened,subscribed}` is hard-coded in the `UQ_offerings_active_per_artwork` predicate with no shared TS constant; drift risk when a future M05 status is added. **Concrete hardening:** ensure the WS6b integration test asserts the index *predicate* (not just enum behavior) so a future status addition that forgets the index WHERE-clause fails a test.
8. **`created_at`/`updated_at` type skew** (data-integrity P3, informational) — `BaseEntity`'s `@CreateDateColumn`/`@UpdateDateColumn` specify no `type` (driver maps to `timestamp`) while migrations create `timestamptz`. Systemic across every table, harmless under `synchronize:false`. NOT introduced by this PR — a codebase-wide fix if ever addressed.

## Proposed Solutions
1. Triage sign-off: mark 1–6, 8 as accepted/won't-fix (or spin out any the team disagrees with). For 7, apply the small integration-test predicate assertion.

## Recommended Action
**RESOLVED.** Items 1–6 and 8 **accepted as-is (won't-fix)** — each is either the documented codebase
convention, a deliberate distinct-error-semantics choice, or a systemic/pre-existing pattern (items 1 and 8
are not offerings-specific). Item 7 **actioned**: added an `it.each(['planned','approved','opened','subscribed'])`
drift-guard to the integration suite asserting every non-terminal status participates in
`UQ_offerings_active_per_artwork`, so a future status added to `OFFERING_STATUSES` but forgotten in the
index WHERE-clause fails a test.

## Technical Details
- Files per item above. Items 1 and 8 are systemic/pre-existing, not offerings-specific.

## Acceptance Criteria
- [x] Items 1–6, 8 confirmed accepted (won't-fix; rationale above).
- [x] Item 7: integration test asserts every non-terminal status is covered by `UQ_offerings_active_per_artwork`.

## Work Log
- 2026-08-18: created from PR #36 review (security-sentinel, performance-oracle, code-simplicity-reviewer, architecture-strategist, data-integrity-guardian — all P3 accept/keep).
- 2026-08-18: RESOLVED — items 1–6/8 accepted; item 7 drift-guard added (integration 11→15). Build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
