---
status: complete
priority: p3
issue_id: 137
tags: [code-review, security, export, TOV-40]
dependencies: [130]
---

# GET /me/wallets has no route throttle (inherits the loose global default)

## Problem Statement
The three export routes set tight limits (3/10/30 per 60s); `GET /me/wallets` has no `@Throttle`, so it falls back to the global default (~100/60s). Not unlimited, but 3–33× looser than its sibling money routes — and it is the discovery step that enumerates the caller's wallet ids/addresses/exported-state (the inputs to then hit the export routes). Reviewer opinions split: pattern-recognition considers no-throttle consistent with plain read endpoints; security-sentinel flags it as a money-flow discovery surface deserving parity.

## Findings
- `src/modules/wallets/me/me-wallets.controller.ts:18` — `list()` has no `@Throttle`.
- Export routes: `wallet-export.controller.ts:26,38,49` (3/10/30).

## Proposed Solutions

### Option A: Add @Throttle({ default: { ttl: 60000, limit: 30 } }) for parity with the status route
- **Pros:** Consistent money-surface throttling; bounds discovery.
- **Cons:** Minor deviation from "plain reads inherit the global default."
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Add `@Throttle(30/min)` for parity with the status route (decided: throttle the discovery surface).

## Implemented Solution
Resolved as part of [[130]]: when the `GET /me/wallets` list handler was folded into
`WalletExportController`, it received `@Throttle({ default: { ttl: 60000, limit: 30 } })` — parity with
the export status route, bounding the wallet-discovery surface.

## Technical Details
Affected: `export/wallet-export.controller.ts` (`list()` throttle). See [[130]].

## Acceptance Criteria
- [x] Decision recorded (throttle) and applied.

## Work Log
- 2026-07-14: Filed from PR #25 review (security vs pattern reviewers).
- 2026-07-15: Throttled the list route (30/min) as part of the 130 merge. Marked complete.
