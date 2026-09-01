---
status: complete
priority: p3
issue_id: 280
tags: [code-review, test-quality, TOV-153, PR-38]
dependencies: []
---

# Preview test suite has some redundant error-code assertions

## Problem Statement
The 409/422/band-invalid/404 mappings are asserted three times: in the helper unit spec
(`offering-planning.helpers.spec.ts`), re-asserted through `OfferingPreviewService`
(`offering-preview.service.spec.ts`), and again over HTTP in `backoffice-offering-preview.e2e-spec.ts`.
The service spec's genuinely unique value is the **precedence** case (band-before-artwork), the no-band
shape, and the bigint-exactness edge; its pure error-code re-checks add little over the helper spec that
already proves them. Separately, `offering-summary.dto.spec.ts`'s second case ("non-planned active
status through unchanged") exercises a passthrough with no branching over the first case.

This is test-suite tidiness, not a correctness gap — the coverage is (if anything) generous. Trim only
if the team prefers leaner specs.

## Findings
- **code-simplicity-reviewer (P3):** "The pure error-code re-checks in the service spec … add little
  over the helper spec … Consider trimming the service spec to its unique cases." + "Trivial second DTO
  test … Adds no coverage over the first test."
- Evidence: `test/unit/modules/fractionalization/offering-preview.service.spec.ts` (error-code cases),
  `test/unit/modules/fractionalization/offering-summary.dto.spec.ts` (2nd case).

## Proposed Solutions
### Option A — Trim the service spec to its unique cases (precedence, no-band shape, bigint edge)
- Keep the e2e error-code coverage (it proves the wiring); drop the duplicate service-level error-code
  assertions already covered by the helper spec.
- **Pros:** leaner, intent-revealing specs. **Cons:** slightly less redundant defense-in-depth.
  **Effort:** Small. **Risk:** Low.

### Option B — Leave as-is
- **Pros:** belt-and-suspenders across layers. **Cons:** the redundancy the reviewer flagged.
  **Effort:** None.

## Recommended Action
**Conservative trim (chosen) — remove only genuinely-redundant cases.**

## Resolution
Removed two cases with zero coverage loss:
- The standalone "invalid band low>=high → 422" service case — fully subsumed by the precedence test
  right below it (same low>=high band, same 422 `OFFERING_BAND_INVALID` assertion); left a comment noting so.
- The summary-DTO "non-planned active status through unchanged" case — a passthrough no-op over the
  first mapping test.

Deliberately KEPT the remaining cross-layer overlap (409 / no-float asserted in the helper spec, the
service spec, and the e2e): those prove the service method *delegates* to the shared helpers and that
the wiring returns the codes over HTTP — intentional defense-in-depth, not redundancy. Verified: the
two specs green (10 cases).

## Technical Details
- `test/unit/modules/fractionalization/offering-preview.service.spec.ts`
- `test/unit/modules/fractionalization/offering-summary.dto.spec.ts`

## Acceptance Criteria
- [ ] If trimmed: unit suite still covers precedence, no-band shape, bigint exactness, and the DTO map;
      all green.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38), code-simplicity P3. Lowest priority; coverage is
  currently strong, this is only about redundancy.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
