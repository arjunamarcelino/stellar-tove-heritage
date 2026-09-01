---
status: complete
priority: p3
issue_id: 307
tags: [code-review, quality, cleanup]
dependencies: []
---
# Minor cleanups: controller no-op, missing index caveat, count number↔string, port doc note

## Problem Statement
A bundle of small, low-risk consistency/cleanup items surfaced by review.

## Findings
- `src/modules/offerings/bids/offering-bids.controller.ts:69` — `return (await this.bidsService.getMyBid(...)) ?? null;` is a no-op (`getMyBid` already returns `| null`) and the method needn't be `async`. → collapse to `return this.bidsService.getMyBid(userId, offeringId);`.
- `src/modules/offerings/repositories/offering-bid.repository.ts` (`findMyActiveBid`) — no plain `(offering_id, collector_sub)` btree; relies on the partial unique index + custom plans. Port the PgBouncer/generic-plan caveat comment from `offering.repository.ts:44-46`.
- `count` is `number` in prepare DTOs (`prepare-bid.dto.ts:24`, `prepare-bid-response.dto.ts:38`) but `string` in `bid-response.dto.ts:14` — the same logical field toggles number↔string across prepare/submit/resource. Consider standardizing the response `count` to `string` to match the money-as-string convention (deliberate today; clarity nit for FE).
- `src/modules/relayer/relayer.service.interface.ts` — `IRelayerService` now aggregates deploy + transfer + holdings + bid (7 methods, 3 concerns). Accepted as-is (all share one adapter + one relayer-account lock). Add a one-line note to `relayer/CLAUDE.md` that the port intentionally aggregates all passkey-signed money flows behind the shared lock, so a future reviewer doesn't "fix" it by splitting.
- Helper placement: `bid-money.ts` lives in `offerings/constants/` while `bid-idempotency.ts` lives in `offerings/bids/` — confirm the split is deliberate (money-math leaf in `constants/`, flow helper in `bids/`) or unify.

## Proposed Solutions
### Option A — Apply the trivial fixes and record the open decisions
- Description: Apply the controller collapse, port the index caveat comment, and add the `relayer/CLAUDE.md` aggregation note; then decide (and record) the count-string standardization and the helper-placement question.
- Pros: Removes dead code, documents a real query-plan caveat, prevents a future mistaken port split; captures the two judgment calls explicitly.
- Cons: Touches several files; the count-string change ripples to FE contract if adopted.
- Effort: Small
- Risk: Low

### Option B — Cherry-pick only the zero-risk items
- Description: Apply only the controller no-op removal, index caveat comment, and CLAUDE.md note; defer the count-string and helper-placement questions.
- Pros: Absolute-minimum-risk subset; no contract change.
- Cons: Leaves the number↔string inconsistency and helper-placement ambiguity unresolved.
- Effort: Small
- Risk: Low

## Recommended Action

## Technical Details
The controller change is a pure simplification (the service already returns `| null`, so the `?? null` and `async`/`await` are redundant). The index caveat is documentation-only, mirroring the existing note at `offering.repository.ts:44-46` about PgBouncer/generic plans and partial-index reliance. The count number↔string and helper-placement items are deliberate-vs-accidental judgment calls to be recorded, not necessarily changed.

## Acceptance Criteria
- The no-op controller code is removed (method collapsed, no needless `async`).
- The index caveat comment is ported to `findMyActiveBid`, and the port-aggregation note is added to `relayer/CLAUDE.md`.
- The count-string and helper-placement decisions are recorded (applied or explicitly deferred with rationale).

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

- **Controller no-op removed:** `getMyBid` is no longer `async` and drops the redundant `?? null`
  (`getMyBid` already returns `BidResponseDto | null`).
- **`findMyActiveBid` index caveat:** added during todo 294 — the method now carries the same
  PgBouncer/generic-plan note as `OfferingRepository.findActiveByArtworkId`.
- **`IRelayerService` aggregation note:** added a JSDoc banner on the interface (no `relayer/CLAUDE.md`
  exists) explaining the fat interface is a deliberate ISP trade-off behind the single shared relayer
  account + send-lock — "do not split."
- **`count` number↔string:** kept as-is by decision — input DTOs use `number` (validated `@IsInt`), and the
  bid *resource* surfaces the `numeric(39,0)` column verbatim as `string`. Documented rather than churned.
- **Helper placement:** confirmed deliberate — `bid-money.ts` (domain-invariant money math) lives in
  `offerings/constants/` next to `stroops.constant`; `bid-idempotency.ts` (flow helper) lives in `bids/`.

Build + lint clean; e2e 7/7.
