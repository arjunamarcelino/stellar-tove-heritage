---
status: complete
priority: p3
issue_id: 392
tags: [code-review, tov-177, pr-49, performance, database]
dependencies: []
---
# Query micro-optimizations (non-indexed sort + duplicate wallet resolution)

## Problem Statement
Two micro-optimizations on the read/hot paths. Harmless at current scale (the performance review confirmed the
money path is otherwise fully index-covered, no N+1, no RPC under any lock) — logged so they aren't rediscovered.

## Findings
1. **`findOpenQuotesForRfq` sorts on a non-indexed key.** `quote.repository.ts:132-155` —
   `ORDER BY q.price_per_fraction_stroops ASC, q.created_at ASC` is not covered by
   `UQ_quotes_active_per_rfq (rfq_id, holder_sub)`, so Postgres fetches the RFQ's open quotes via the partial
   index then does an in-memory Sort. Bounded today (tens of quotes/RFQ); grows only if an RFQ ever attracts
   hundreds. → Add `(rfq_id, price_per_fraction_stroops, created_at) WHERE status='open' AND deleted_at IS NULL`
   **only if** quotes-per-RFQ is expected to get large; otherwise leave it. (performance M1.)
2. **Duplicate embedded-wallet resolution per accept/authorize request.**
   - `accept.service.ts` — `accept()` calls `resolveWallet(userId)` at `:130` and `resolveContext` resolves it
     again at `:240` (two identical `resolveEmbeddedWalletForUser` lookups per accept).
   - `authorize.service.ts` — `authorize()` at `:129` and `resolveContext` at `:217`.
   → Return the already-resolved wallet from `resolveContext` (it's in `AuthContext`) instead of re-resolving. A
   few queries saved per request; not on any lock. Overlaps with the helper-dedup in
   [[390-pending-p3-dead-code-and-audit-trail-gaps]] (item 4). (performance M2.)

## Proposed Solutions
### Option A — Fix the duplicate resolution now; defer the index (Recommended)
- Thread the resolved wallet out of `resolveContext` so each request resolves once. Leave the sort un-indexed
  until quotes-per-RFQ demonstrably grows (revisit with real data).
- Effort: Small · Risk: Low.

## Recommended Action
Option A. Only add the M1 index if product expects large quote fan-out per RFQ.

## Technical Details
- Affected: `accept.service.ts`, `authorize.service.ts` (wallet resolution); optionally migration + `quote.repository.ts` (M1 index).

## Acceptance Criteria
- [ ] Each accept/authorize request performs a single embedded-wallet resolution.
- [ ] (If pursued) the open-quotes read is index-served for ORDER BY at scale.

## Resolution (2026-08-22, complete — Option A: fixed M2, deferred M1)
**M2 (fixed).** Both `AcceptService` and `AuthorizeService` now resolve the caller's embedded wallet ONCE and
thread its address into `resolveContext` (new `buyerWallet`/`sellerWallet` param), instead of re-resolving
inside `resolveContext`. Each accept/authorize request does one embedded-wallet lookup, not two. Error ordering
is preserved (a missing wallet still maps to the same 4xx code; the ownership/whitelist gates run unchanged).

**M1 (deferred).** `findOpenQuotesForRfq`'s `ORDER BY price, created_at` sort remains un-indexed — harmless at
the current bounded quotes-per-RFQ (tens); an index is only worth adding if product expects large quote fan-out
per RFQ. Documented, no change.

Verified: build 0, lint clean, accept e2e 4/4 + authorize e2e 4/4 (ownership/whitelist/not-authorized gates all
still fire in order).

### Files changed
- `src/modules/marketplace/settlement/accept/accept.service.ts`,
  `src/modules/marketplace/settlement/accept/authorize.service.ts` (thread the resolved wallet)

## Work Log
- 2026-08-22: Filed from PR #49 review (performance M1/M2).
- 2026-08-22: Deduped the per-request wallet resolution (M2); M1 deferred; marked complete.
