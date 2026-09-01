---
status: complete
priority: p2
issue_id: 385
tags: [code-review, tov-177, pr-49, money-path, correctness, marketplace]
dependencies: []
---
# Over-authorization free-balance gate counts the quote being re-authorized against itself

## Problem Statement
On the authorize path, `free = onchain − sumAuthorizedLockedCount(holder, fractionContract)`, and
`sumAuthorizedLockedCount` sums **every** quote that is `open` AND `seller_auth_entry IS NOT NULL` AND
`valid_until > now()` — which **includes the very quote being (re-)authorized** once it already carries a prior
signature. A seller who committed their whole on-chain balance to one quote, then re-authorizes it (e.g. a new
Idempotency-Key after the stored seller signature's `seller_auth_expires_ledger` lapsed while `valid_until` is
still in the future), gets `free = onchain − count = 0 < count` → `422 QUOTE_OVER_AUTHORIZED`. The quote's own
commitment is double-counted against its own re-authorization. Fails **closed** (safe, no over-commit), but can
strand a quote whose on-chain signature expired inside its validity window with no way to re-sign.

Flagged by data-integrity (P2) and security (P3-1). Filed **P2** — it blocks a supported flow
(`markAuthorized` CAS's on `status='open'`, i.e. re-auth is intended), though the triggering window is narrow
because seller-sig validity ≈ `validUntil`.

## Findings
- `src/modules/marketplace/settlement/accept/authorize.service.ts:160-162` — computes `free` without excluding
  the target quote.
- `src/modules/marketplace/quotes/repositories/quote.repository.ts:180-198` — `sumAuthorizedLockedCount` has no
  `q.id <> :quoteId` predicate.
- The auth columns are intentionally re-writable (`quote.entity.ts:~63`) and `markAuthorized` supports re-auth,
  so excluding self is consistent with intent.

## Proposed Solutions
### Option A — Exclude the target quote from the locked sum on the authorize path (Recommended)
- Add an optional `excludeQuoteId` param to `sumAuthorizedLockedCount` and pass the target quote id from
  `authorize.service.ts`; the accept/other callers pass nothing (unchanged).
- Pros: one-line predicate; fixes the false 422. Cons: none. Effort: Small · Risk: Low.

### Option B — Document as a known limitation
- If product decides re-auth of a fully-committed quote is out of scope, document the constraint and leave as-is.
- Pros: zero code. Cons: leaves a confusing false-positive on a legitimate flow. Effort: None · Risk: Low.

## Recommended Action
Option A.

## Technical Details
- Affected: `authorize.service.ts`, `quote.repository.ts` (`sumAuthorizedLockedCount`), plus a unit/integration
  test for "re-authorize a fully-committed quote succeeds".

## Acceptance Criteria
- [ ] Re-authorizing an already-authorized, still-`open`, fully-committed quote succeeds (no false 422).
- [ ] A genuinely over-committing NEW quote still gets `422 QUOTE_OVER_AUTHORIZED`.

## Resolution (2026-08-22, complete — Option A)
Added an optional `opts.excludeQuoteId` to `IQuoteRepository.sumAuthorizedLockedCount` (interface + impl); the
repo appends `AND q.id <> :excludeQuoteId` when supplied. `AuthorizeService.authorize` now passes
`{ excludeQuoteId: quoteId }` inside the advisory-locked txn, so re-authorizing an already-authorized, still-open
quote no longer counts its own commitment against itself. A genuinely over-committing new quote still gets
`422 QUOTE_OVER_AUTHORIZED` (the target-quote exclusion only removes the row being re-signed). Verified: build 0
issues, lint clean, quote-auth integration 8/8 (added an `excludeQuoteId → 0n` assertion to the
`sumAuthorizedLockedCount` test).

### Files changed
- `src/modules/marketplace/quotes/repositories/quote-repository.interface.ts` (signature + JSDoc)
- `src/modules/marketplace/quotes/repositories/quote.repository.ts` (`sumAuthorizedLockedCount` predicate)
- `src/modules/marketplace/settlement/accept/authorize.service.ts` (pass `excludeQuoteId`)
- `test/integration/modules/marketplace/quote-auth.repository.integration.spec.ts` (assertion)

## Work Log
- 2026-08-22: Filed from PR #49 review (data-integrity + security).
- 2026-08-22: Fixed via Option A; tests green; marked complete.
