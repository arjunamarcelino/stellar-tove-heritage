---
status: complete
priority: p3
issue_id: 257
tags: [code-review, architecture, forward-looking, TOV-237, PR-35]
dependencies: []
---

# Promote `slug.ts` to a shared location when TOV-189 unifies the artworks read model

## Problem Statement
`slugFallback` currently lives under the `me/` surface, but slug is a fractionalization-domain concern. When the public `artworks/` browse (TOV-189) needs artwork slugs, re-implementing it there would let the two surfaces drift on slug format.

## Findings
Flagged by architecture-strategist (P3) and code-simplicity-reviewer (P3-4).
- `src/modules/fractionalization/me/slug.ts` — one pure, tested function (`slug.spec.ts`), currently only used by `dto/holding.dto.ts:54`. It is the only kebab-slug implementation in `src/` (grep-confirmed).

## Proposed Solutions
1. When TOV-189 lands, move `slug.ts` up to a shared fractionalization/common location and have both surfaces consume it (single source of slug format). Effort: Small, deferred. Risk: none now.
2. Leave in place for this PR (single caller); revisit at TOV-189. Effort: none.

## Recommended Action
**RESOLVED — Solution 2 (deferred to TOV-189).** No action this PR: `slugFallback` stays under `fractionalization/me/` with its single caller (`HoldingDto`). Marker recorded so that when TOV-189 unifies the public `artworks/` read model and needs artwork slugs, the helper is promoted to a shared fractionalization/common location and consumed by both surfaces (single source of slug format) rather than re-implemented. Tracked on the TOV-189 ticket scope.

## Technical Details
- No code change. Forward-looking marker to prevent slug-format drift between `me/holdings` and the future public artworks browse.

## Acceptance Criteria
- [x] Decision recorded: keep in place now; promote + share at TOV-189.
- [ ] (At TOV-189) slug derivation has one shared implementation used by both surfaces.

## Work Log
- 2026-07-18: created from PR #35 review (architecture-strategist P3, simplicity P3-4).
- 2026-07-18: RESOLVED — deferred to TOV-189 (no action this PR); promotion condition documented.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
