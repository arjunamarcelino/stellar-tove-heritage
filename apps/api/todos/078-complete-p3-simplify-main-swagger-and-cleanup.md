---
status: complete
priority: p3
issue_id: 078
tags: [code-review, quality, simplicity]
dependencies: []
---

# Minor Cleanups: Swagger/Docs Dedup, Immutable Module Arrays, Dead Env

## Problem Statement
Several small, low-risk cleanups in `main.ts` and adjacent files: two near-identical Swagger `DocumentBuilder` blocks, two near-identical non-dev `docs/json` route registrations, mutable exported module arrays, and a now-redundant `THROTTLE_LIMIT` in the e2e config. None affect behavior; they reduce duplication and tighten types.

## Findings
- `src/main.ts` — public and backoffice `DocumentBuilder` blocks differ only in title/description/module list (extract a `buildDoc(title, desc, include)` helper).
- `src/main.ts` — the two non-dev `httpAdapter.get(.../docs/json...)` handlers are structurally identical (loop over `[[apiPrefix, publicDocument], [backofficeApiPrefix, backofficeDocument]]`).
- `src/modules/public-api.module.ts:15`, `src/modules/backoffice/backoffice.module.ts` — `PUBLIC_MODULES`/`BACKOFFICE_MODULES` are mutable; add `as const` / `readonly` (main.ts already spreads defensively).
- `vitest.config.e2e.ts` — `THROTTLE_LIMIT: '10000'` is now redundant once every e2e spec uses the no-op `ThrottlerStorage` override (see #075); keep the override, drop the weaker env mechanism.
- Flagged by simplicity (P3) and TypeScript (P3).

## Proposed Solutions

### Option A: Apply all four cleanups
- **Description:** Extract `buildDoc` helper, loop the docs/json registrations, mark the module arrays `as const`, and remove the dead `THROTTLE_LIMIT` after confirming all e2e specs use the override.
- **Pros:** ~30-40 fewer lines; single-sourced Swagger version/auth config; stronger typing.
- **Cons:** Touches main.ts (low risk; covered by smoke test + e2e).
- **Effort:** Small
- **Risk:** Low

### Option B: Cherry-pick (arrays + dead env only)
- **Description:** Do the zero-risk items (`as const`, drop `THROTTLE_LIMIT`) and skip the main.ts refactor.
- **Pros:** Minimal.
- **Cons:** Leaves the Swagger duplication.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — apply the cleanups.

## Implemented Solution
- **`buildDoc` helper** in `main.ts` — the two `DocumentBuilder` blocks collapse into a single
  `buildDoc(title, description, include)` helper; version/auth config is now single-sourced.
- **Immutable module arrays** — `PUBLIC_MODULES` / `BACKOFFICE_MODULES` are now `as const`; the
  two `RouterModule` `children:` sites spread (`[...MODULES]`) so the readonly tuples stay
  assignable.
- **Dead `THROTTLE_LIMIT` removed** from `vitest.config.e2e.ts` — the `noOpThrottlerStorage`
  override (see #075) already neutralizes throttling, so the inflated limit was redundant.
- **N/A:** the "docs/json route dedup" item is moot — #076 removed the second (backoffice)
  `docs/json` handler, leaving a single public one.

Verified: build TSC 0 issues; unit 164, e2e 36 (throttle override alone holds without
`THROTTLE_LIMIT`); lint clean; dev Swagger renders both docs (Public 11 paths, Backoffice 20).

## Technical Details
- Affected: `src/main.ts`, `src/modules/public-api.module.ts`, `src/modules/backoffice/backoffice.module.ts`, `vitest.config.e2e.ts`. Depends on #075 for the `THROTTLE_LIMIT` removal.

## Acceptance Criteria
- [x] Swagger docs still render both specs correctly at `/docs/public` and `/docs/backoffice`.
- [x] Build + all suites pass (unit 164, e2e 36); lint clean.

## Work Log
- 2026-07-01: Filed from PR #17 review (simplicity + TypeScript reviewers).
- 2026-07-01: Applied buildDoc helper, `as const` module arrays (+ spread at children sites), removed dead THROTTLE_LIMIT. docs/json dedup moot after #076. Verified build + unit 164 + e2e 36 + dev Swagger render.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
