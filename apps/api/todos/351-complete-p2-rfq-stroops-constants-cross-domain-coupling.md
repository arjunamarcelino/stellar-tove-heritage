---
status: complete
priority: p2
issue_id: 351
tags: [code-review, architecture, tov-172]
dependencies: []
---
# `marketplace/rfqs` imports money primitives from `@modules/offerings` — cross-domain coupling (PR #46)

## Problem Statement
RFQ creation imports `STROOPS_RE`, `MAX_STROOPS`, and `MAX_I128` from
`@modules/offerings/constants/stroops.constant`. `marketplace` and `offerings` are sibling feature domains;
neither should depend on the other. These are platform-wide Stellar/Soroban money primitives (canonical
stroops regex, the 2^96−1 USDC ceiling, the signed-i128 ceiling), not offering-specific — yet they're homed
under `offerings/`, and `MAX_I128`'s own JSDoc documents it purely in `close_and_settle`/TOV-160 settlement
terms. So RFQ now carries a `marketplace → offerings` source edge for what is really a shared kernel, and every
future M06 consumer (FR-06.02 quotes, accept-settle) inherits it.

## Findings
Source: architecture-strategist (P2), corroborated by the plan's own deferred "optional follow-up".

- `src/modules/marketplace/rfqs/rfqs.service.ts:21` — `import { MAX_STROOPS, MAX_I128 } from '@modules/offerings/constants/stroops.constant'`
- `src/modules/marketplace/rfqs/dto/create-rfq.dto.ts:3` — `import { STROOPS_RE } from '@modules/offerings/constants/stroops.constant'`

## Proposed Solutions
### Option A — Relocate the constants to `@common/constants/stroops.constant.ts`
- Description: Move the dependency-free leaf to `@common`; re-point BOTH `offerings` and `rfqs` at it. Optionally
  leave a re-export shim at the old path to minimize churn in the offerings tree, or update imports directly.
- Pros: Removes the sibling edge for current + future consumers; matches the existing `@common/soroban/*`,
  `@common/constants/*` neutral-home pattern; mechanical move (dependency-free leaf).
- Cons: Touches the offerings import sites (or adds a shim); slightly widens the PR/its follow-up footprint.
- Effort: Small-Medium (mechanical, but many offering import sites)
- Risk: Low

### Option B — Leave as-is
- Description: Accept the `marketplace → offerings` edge.
- Pros: Zero churn.
- Cons: The coupling grows as M06 adds consumers; `MAX_I128`'s offering-settlement JSDoc misdescribes its RFQ use.
- Effort: None
- Risk: Low but compounding.

## Recommended Action
Option A — relocate to `@common`. Approved 2026-08-21.

## Resolution
Moved `STROOPS_RE`/`MAX_STROOPS`/`MAX_I128` to `src/common/constants/stroops.constant.ts` (generalized the
`MAX_I128` JSDoc beyond TOV-160 settlement) and deleted `src/modules/offerings/constants/stroops.constant.ts`.
Re-pointed all 9 import sites (`@modules/offerings/constants/…` and 3 relative `./…` imports in
`offering-planning.helpers.ts`, `clearing.ts`, `constants/bid-money.ts`) to `@common/constants/stroops.constant`.
No more `marketplace → offerings` edge for money primitives. Updated the `modules/CLAUDE.md` note.
Verified: `yarn build` 0 issues, `yarn lint` clean, offerings + marketplace unit consumers green (63 tests).

## Technical Details
- Affected on move: `offerings/constants/stroops.constant.ts` (source), all offering + rfq import sites.
- The plan already flagged this as a deferred follow-up to keep the RFQ PR's footprint tight.

## Acceptance Criteria
- [ ] `STROOPS_RE`/`MAX_STROOPS`/`MAX_I128` live in a neutral home; no `marketplace → offerings` import remains.
- [ ] `MAX_I128` JSDoc generalized beyond TOV-160 settlement.
- [ ] build + lint + full suite green.

## Work Log
- 2026-08-21 — Filed from PR #46 review (architecture-strategist).

## Resources
- PR #46; `src/modules/offerings/constants/stroops.constant.ts`.
