---
status: complete
priority: p2
issue_id: 370
tags: [code-review, correctness, tov-175, pr-48]
dependencies: []
---
# Cheap pre-check produces a false 409 for a holder whose own quote has lapsed but is not yet reaped (PR #48)

## Problem Statement
A holder who set a `validUntil` shorter than the RFQ's expiry, whose quote then lapses while the RFQ is
still `open`, can **never re-quote that RFQ**. The fast-fail pre-check rejects them with
`409 QUOTE_ALREADY_OPEN`, and the in-transaction lazy-reap that would free their slot is gated *behind* that
very pre-check — so it never runs for this caller. This is a genuine functional dead-end on a real user flow
(quote lapses → holder wants to re-quote the same still-open RFQ).

## Findings
Independently flagged **P2** by kieran-typescript-reviewer and **P3** by performance-oracle (same root cause).
- `src/modules/marketplace/quotes/quotes.service.ts:123` — pre-check `hasOpenQuoteForRfq(rfqId, userId)` runs
  BEFORE the chain read and BEFORE the transaction.
- `src/modules/marketplace/quotes/repositories/quote.repository.ts:56-64` — the query matches the
  `UQ_quotes_active_per_rfq` predicate (`status='open' AND deleted_at IS NULL`) with **no `valid_until`
  filter**, so a lapsed-but-`open` quote reads as a live conflict.
- `quotes.service.ts:135` — `reapLapsed` (flips lapsed `open`→`expired`) runs only INSIDE the txn, which is
  unreachable once the pre-check has thrown. There is no background sweeper (confirmed: `reapLapsed`'s only
  runtime call site is line 135).
- The authoritative in-txn re-check (`quotes.service.ts:136`) is correct — it runs *after* the reap. Only the
  pre-check is wrong. The sole indirect escape is quoting a *different* RFQ on the same token (that txn reaps
  across all the holder's RFQs on the token) — non-obvious and not guaranteed.

## Proposed Solutions
### Option A — Add `valid_until > now()` to the PRE-CHECK path only (Recommended)
- Give `hasOpenQuoteForRfq` (or a dedicated pre-check method) an optional "exclude lapsed" mode used only at
  line 123, so the cheap check predicts the post-reap authoritative state. Keep the authoritative in-txn check
  (line 136) matching the index predicate exactly.
- Pros: fixes the dead-end; keeps the RPC-amplification benefit of the pre-check for genuine live conflicts.
- Cons: the pre-check no longer uses the exact partial index (adds a `valid_until` residual) — negligible, the
  set is tiny (one holder, one RFQ).
- Effort: Small · Risk: Low
### Option B — Drop the pre-check entirely
- Pay the ~2.5s chain read on the duplicate-submit path; the in-txn reap + authoritative check then handle it.
- Pros: simplest; single source of truth under the lock.
- Cons: re-introduces the 409-replay chain-read amplification the pre-check was added to prevent (todo from
  the plan review / security-sentinel).
- Effort: Small · Risk: Low

## Recommended Action
Option A. It preserves the amplification guard while closing the re-quote dead-end.

## Resolution (2026-08-22, complete — Option A)
`hasOpenQuoteForRfq`'s 3rd param became `opts?: { manager?; excludeLapsed? }`. The pre-lock fast-fail now
calls it with `{ excludeLapsed: true }`, which adds `AND valid_until > now()` so a lapsed-but-unreaped own
quote is NOT treated as a live conflict. The authoritative under-lock check runs `{ manager }` (no
`excludeLapsed`) AFTER `reapLapsed`, so it correctly matches the `status='open'` index predicate. Net: a holder
whose quote lapsed while the RFQ is still open can now re-quote (the lapsed row is reaped to `expired` in-txn),
while a genuinely live open quote still fast-fails 409 without a wasted chain read. Build 0; quote unit 26 /
integration 13 / e2e 16 green.

## Technical Details (as-built)
- `quote-repository.interface.ts` + `quote.repository.ts` — `hasOpenQuoteForRfq(rfqId, holderSub, opts?)`.
- `quotes.service.ts` — pre-check `{ excludeLapsed: true }`; under-lock `{ manager }`.
- Tests: integration `hasOpenQuoteForRfq({excludeLapsed})` case; e2e `re-quote succeeds after own quote lapses`.

## Technical Details
- Affected: `quotes.service.ts` (pre-check call), `quote.repository.ts` (`hasOpenQuoteForRfq`),
  `quote-repository.interface.ts` (signature).
- No migration/schema change.

## Acceptance Criteria
- [x] A holder whose own quote on an RFQ has lapsed (`valid_until <= now`, still `status='open'`) can submit a
      new quote on that same still-open RFQ and gets 201 (the lapsed one is reaped to `expired`).
- [x] A holder with a genuinely live open quote on the RFQ still gets `409 QUOTE_ALREADY_OPEN` from the cheap
      pre-check (no wasted chain read).
- [x] Regression test added (unit and/or e2e) for the lapsed-own-quote re-quote path.

## Work Log
- 2026-08-22: Filed from PR #48 review (kieran-typescript P2 + performance-oracle P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
