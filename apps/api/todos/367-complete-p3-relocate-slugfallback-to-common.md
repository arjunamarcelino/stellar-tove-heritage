---
status: complete
priority: p3
issue_id: 367
tags: [code-review, architecture, cleanup, tov-174, pr-47]
dependencies: []
---
# Relocate `slugFallback` to `@common` so read surfaces don't reach into `fractionalization/me` (PR #47)

## Problem Statement
`NotificationResponseDto.fromRow` derives `artworkSlug` via `slugFallback` imported from
`@modules/fractionalization/me/slug`. It's a pure function (no DI/module edge), so it does not violate the
"no fractionalization on the read path" module-graph rule — but it is a cross-domain **code** coupling: the
`marketplace/notifications` read DTO reaches into `fractionalization/me/` for a shared helper. The same helper
is already reused by `me/holdings`, so two read surfaces now depend on a leaf buried in another domain.

## Findings
Source: architecture-strategist (LOW).
- `src/modules/marketplace/notifications/dto/notification-response.dto.ts:2` (the import)
- `src/modules/fractionalization/me/slug.ts` (the helper, also used by `HoldingDto`)

## Proposed Solutions
### Option A — Move `slugFallback` to `@common` (Recommended)
- Description: Relocate to e.g. `src/common/utils/slug.util.ts`; update both `HoldingDto` and
  `NotificationResponseDto` imports. Both surfaces then depend on a neutral leaf.
- Pros: Removes cross-domain code coupling; a shared display helper belongs in `@common`.
- Cons: Touches a fractionalization file + its test import.
- Effort: Small · Risk: Low
### Option B — Leave as-is
- Description: Accept the pure-function reach (no runtime edge).
- Pros: Zero churn.
- Cons: Coupling persists; a third consumer would deepen it.
- Effort: None · Risk: None

## Recommended Action
Option A — move to `@common`.

## Resolution (2026-08-21, complete)
`git mv src/modules/fractionalization/me/slug.ts → src/common/utils/slug.util.ts`. Updated the three
importers (`fractionalization/me/dto/holding.dto.ts`, `marketplace/notifications/dto/notification-response.dto.ts`,
`test/unit/modules/me-holdings/slug.spec.ts`) to `@common/utils/slug.util`, refreshed the helper's docstring
(now shared by both read surfaces), and updated the `me/slug` mention in `src/modules/CLAUDE.md`. Both read
surfaces now depend on a neutral `@common` leaf instead of one reaching into another domain. tsc + lint clean;
slug + notifications unit tests green.

## Acceptance Criteria
- [ ] `slugFallback` (if moved) lives in `@common`; holdings + notifications import it from there; tests green.

## Work Log
- 2026-08-21: Filed from PR #47 review (architecture-strategist, LOW).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
