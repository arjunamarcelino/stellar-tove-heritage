---
status: complete
priority: p2
issue_id: 372
tags: [code-review, architecture, tov-175, pr-48]
dependencies: []
---
# Quotes depends on another feature-surface's implementation helpers, not just its port (PR #48)

## Problem Statement
The marketplace `quotes/` module reaches into the fractionalization **`me/` (holdings) public surface** for
its implementation utilities — a sibling surface's internals — rather than a neutral shared location. Reusing
the `FRACTION_READ_SERVICE` port token + `IFractionReadService` interface is clean; importing the concrete
adapter and `parseAmount`/`fraction-read.errors` from another surface's subtree is a layering/ownership smell.
No dependency cycle exists (fractionalization does not import marketplace), so this is a maintainability
concern, not a build hazard.

## Findings
Source: architecture-strategist (P2).
- `src/modules/marketplace/quotes/quotes.service.ts:24` imports `parseAmount` from
  `@modules/fractionalization/me/amount`.
- `src/modules/marketplace/quotes/public-quotes.module.ts:8,35` imports the concrete
  `SorobanFractionReadService` from `@modules/fractionalization/me/soroban-fraction-read.service`.
- The port + interface (`quotes.service.ts:21-23`) are the right seam; the impl helpers (`amount`,
  `soroban-fraction-read.service`, `fraction-read.errors`) live under the holdings surface, not the neutral
  `fractionalization/` root.

## Proposed Solutions
### Option A — Relocate the shared read primitives to the `fractionalization/` root (Recommended)
- Move `fraction-read.service.interface`, `soroban-fraction-read.service`, `fraction-read.errors`, `amount`
  (and `FRACTION_READ_SERVICE` binding) up to the neutral `fractionalization/` domain so BOTH the holdings
  surface and quotes import a neutral shared location.
- Pros: correct ownership; both consumers depend on the domain, not on each other.
- Cons: touches the shipped TOV-237 holdings module (imports + the neutral module's exports); needs care not
  to leak `fractionReadConfig` into the config-free neutral module (bind the adapter in the public surfaces,
  export only the port + pure helpers).
- Effort: Medium · Risk: Low-Medium (touches a shipped module)
### Option B — Accept and document
- Add a note (module JSDoc / `src/modules/CLAUDE.md`) that `fractionalization/me/{amount,fraction-read.*}` are
  the sanctioned shared read primitives that other surfaces may import.
- Pros: zero code risk. Cons: enshrines a surface-to-surface dependency.
- Effort: Small · Risk: None

## Recommended Action
Option A if a small refactor is acceptable; otherwise Option B to make the sharing intentional and documented.

## Resolution (2026-08-22, complete — Option B chosen: relocate)
Relocated the shared read primitives from the holdings surface up to the neutral `fractionalization/` root, so
both the holdings surface and quotes now import them from a neutral shared location instead of quotes reaching
into a sibling public surface. `git mv`d `amount.ts`, `fraction-read.errors.ts`, `fraction-read.service.interface.ts`,
`run-bounded.ts`, `soroban-fraction-read.service.ts` from `fractionalization/me/` → `fractionalization/`.
Updated all importers: `me-holdings.service.ts` + `public-me-holdings.module.ts` (now `../` relative),
`quotes.service.ts` + `public-quotes.module.ts` (now `@modules/fractionalization/...`), and the test files
(`fake-fraction-read.ts`, the me-holdings unit specs, both e2e specs). The `FRACTION_READ_SERVICE` binding stays
in the public surfaces (PublicMeHoldingsModule / PublicQuotesModule) — NOT the neutral `FractionalizationModule`
— deliberately, so `fractionReadConfig` never leaks into the config-free neutral module (which `OfferingsModule`
and the integration harness import without that config). Build 0 issues; holdings + quotes unit 61/61 green.

## Technical Details (as-built)
- Moved: `src/modules/fractionalization/{amount,fraction-read.errors,fraction-read.service.interface,run-bounded,soroban-fraction-read.service}.ts`.
- No behavior change; pure relocation + import-path rewrite.

## Technical Details
- Affected (Option A): `fractionalization/me/*` relocation, `public-me-holdings.module.ts`,
  `quotes.service.ts`, `public-quotes.module.ts`, related imports.

## Acceptance Criteria
- [x] Either the shared read primitives live at a neutral shared location both surfaces import, OR the
      cross-surface dependency is explicitly documented as sanctioned. → relocated to `fractionalization/` root.
- [x] The config-free invariant of the neutral `fractionalization` module is preserved (no `fractionReadConfig`
      leak). → binding kept in the public surfaces.

## Work Log
- 2026-08-22: Filed from PR #48 review (architecture-strategist P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
