---
status: complete
priority: p3
issue_id: 242
tags: [code-review, simplicity, yagni, consistency, dto, TOV-240, PR-34]
dependencies: []
---

# Simplicity / consistency nits bundle (guard placement, DTO collapse, enum dedupe, readonly default)

## Problem Statement
Low-severity simplicity and consistency items across the PR. None are defects; grouped for a single triage pass. Note one genuine disagreement between reviewers on the `assertActiveStatus` guard (see #1).

## Findings
1. **`assertActiveStatus` guard — keep vs. trim (reviewers disagree).** simplicity-reviewer calls the dedicated file + type + 2 tests over-engineered because both callers only receive rows from `findActiveByArtworkId(s)` whose SQL already filters `status IN ('deploying','deployed')`, making the throw branch unreachable. security-sentinel, architecture-strategist, and kieran-typescript praise it as correct defense-in-depth that *earns* the narrowed type instead of an `as`-cast lie. **Recommendation: keep the guard, but address placement (#2).** (`dto/active-fraction-status.ts:16`.)
2. **`active-fraction-status.ts` naming/placement (pattern-recognition P2).** It's the only file under any `dto/` folder without a `.dto.ts` suffix, and it's a type + runtime guard, not an I/O contract. Move it to `fractionalization/constants/` or a `dto/`-adjacent helper, or rename to `.dto.ts`.
3. **Dedupe the active-status enum literal (kieran P3).** `['deploying','deployed']` is hand-copied in `fraction-contract-summary.dto.ts:7` and `fraction-contract-detail.dto.ts:14`, plus the type + guard list it. Derive the Swagger `enum` from a shared `ACTIVE_FRACTION_STATUSES` tuple that also backs `ActiveFractionStatus` + `assertActiveStatus` (mirrors how `ARTWORK_STATUSES` backs its type).
4. **`DEFAULT_ARTWORK_LIST_STATUSES` mutable (kieran P3).** `backoffice-artworks.constants.ts:8` is `ArtworkStatus[]`; make it `readonly ArtworkStatus[]` (`In(...)` accepts readonly).
5. **Summary vs detail fraction DTO split (simplicity P3, optional).** Summary is a strict field-subset of detail; could serve one `FractionContractDto` in both and drop `fraction-contract-summary.dto.ts`. Keep only if a trimmed list-row payload is a real product need (admin, low volume — probably not decisive either way).
6. **`backoffice-artworks.constants.ts` one-array file (simplicity P3).** Could inline the single constant atop its only consumer (`backoffice-artworks.service.ts`). Defensible either way; low value.

## Proposed Solutions
- Apply #2, #3, #4 as cheap clarity wins; decide #1 (keep), #5 and #6 explicitly (likely leave). Effort: Small total. Risk: none.

## Recommended Action
**RESOLVED** (user-confirmed decisions).
1. **Guard kept** (defense-in-depth that earns the narrowed type) — not removed.
2. **Relocated** `dto/active-fraction-status.ts` → `constants/active-fraction-status.ts` (it's a type + guard, not an I/O DTO). Imports updated in both fraction DTOs + the unit test.
3. **Enum deduped**: added `ACTIVE_FRACTION_STATUSES` tuple in the new file; both fraction DTOs now render `@ApiProperty({ enum: [...ACTIVE_FRACTION_STATUSES] })` (no more hand-copied literals).
4. **`DEFAULT_ARTWORK_LIST_STATUSES` is now `readonly ArtworkStatus[]`.**
5. Summary vs detail DTO split — **kept** (required-vs-optional field clarity; simplicity's collapse was optional).
6. `backoffice-artworks.constants.ts` one-array file — **kept** (view-policy separation; low value to inline).

## Technical Details
- Affected: `dto/active-fraction-status.ts`, `dto/fraction-contract-*.dto.ts`, `backoffice-artworks.constants.ts`. If #2 moves the guard, update imports in both fraction DTOs.

## Acceptance Criteria
- [ ] Guard keep/trim decided and recorded.
- [ ] If kept: relocated/renamed appropriately; active-status set derived from one shared tuple.
- [ ] `DEFAULT_ARTWORK_LIST_STATUSES` is `readonly`.

## Work Log
- 2026-07-18: created from PR #34 review (code-simplicity, kieran-typescript, pattern-recognition).
- 2026-07-18: RESOLVED — guard kept + moved to `constants/active-fraction-status.ts`, shared `ACTIVE_FRACTION_STATUSES` tuple dedupes the Swagger enum, `DEFAULT_ARTWORK_LIST_STATUSES` made `readonly`. Build + lint clean; 9 unit tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
