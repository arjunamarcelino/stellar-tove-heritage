---
status: complete
priority: p3
issue_id: 378
tags: [code-review, robustness, tov-175, pr-48]
dependencies: []
---
# Residual DB constraint violations can surface as 500 instead of a clean 4xx (PR #48)

## Problem Statement
Three DB-level conditions are currently unreachable-or-rare through the happy path, but if they fire they
produce a generic 500 rather than a mapped 4xx on a money endpoint. Defense-in-depth: keep every constraint
mapped to a clean client signal.

## Findings
Sources: security-sentinel (P3-2), data-integrity-guardian (P3 ×2).
1. **`UQ_quotes_active_per_rfq` 23505 → 500.** `insertOpen`'s `.orIgnore('("holder_sub","rfq_id","idempotency_key_hash")')`
   (`quote.repository.ts:37`) pins the conflict target to `UQ_quotes_idem` only. A 23505 from the active-per-RFQ
   partial-unique (`migration:69-72`) is NOT ignored → aborts the txn → 500. Unreachable via code (the advisory
   lock at `quotes.service.ts:133` + in-txn `hasOpenQuoteForRfq` re-check at `:136` convert the loser to a clean
   409 first), so it only bites on out-of-band DB writes. The safety relies on the implicit invariant "one RFQ ⇒
   one `fraction_contract_id` ⇒ same advisory lock" — worth stating.
2. **`CHK_quotes_validity` 23514 → 500 under clock skew.** `quotes.service.ts:145` guards
   `cappedValidUntil <= Date.now()` (JS wall clock), but `migration:54` enforces `valid_until > created_at` where
   `created_at DEFAULT now()` (DB `transaction_timestamp`, stamped at txn start). If the DB clock leads the app
   clock by more than the remaining validity window, `created_at` can exceed `valid_until` → CHECK violation →
   500. Low probability (seconds of skew), ugly on a money path.
3. **`softRemove(Quote)` → 500.** The guard trigger raises on any `deleted_at` change (`migration:87-89`), so
   `BaseRepository.softRemove` on a `Quote` would 500. No current caller, but a future maintenance path calling
   `quotes.softRemove(...)` gets a raw 500.

## Proposed Solutions
### Option A — Targeted 4xx mapping + interface guard (Recommended)
- (1) Optionally catch a 23505 on the active-per-RFQ constraint name in the service and map to
  `QUOTE_ALREADY_OPEN` (409). (2) Catch `CHK_quotes_validity` 23514 → `QUOTE_INVALID_VALIDITY`/`QUOTE_RFQ_EXPIRED`
  (422), OR derive the freshness re-check from DB `now()` inside the txn instead of `Date.now()`. (3) Override/
  remove `softRemove` on `IQuoteRepository` (throw a clear domain error) or document the ban on the interface.
- Pros: every constraint yields a clean client signal; no raw 500 on the money path. Cons: a little defensive
  catch code; must catch by constraint name (not blanket 23505) to avoid masking the intended orIgnore path.
- Effort: Small · Risk: Low
### Option B — Document as unreachable and accept
- Note the invariant (1), the skew tolerance (2), and the soft-delete ban (3); leave code as-is.
- Pros: zero change. Cons: keeps three raw-500 corners.
- Effort: Small · Risk: Low

## Recommended Action
Option A for (2) (the clock-skew 500 is the only one reachable without out-of-band writes — prefer deriving the
re-check from DB `now()`), plus documenting (1) and (3). (1) and (3) are truly unreachable via code today.

## Resolution (2026-08-22, complete)
1. **Clock-skew `CHK_quotes_validity` 500 → 422** (the reachable one): kept the fast-path JS re-check, and now
   also **catch the 23514** from `insertOpen` (via `isCheckViolation(err,'CHK_quotes_validity')`) and map to
   `QUOTE_RFQ_EXPIRED` (422). The DB CHECK (`valid_until > created_at`, `created_at = DB now()`) is the
   authoritative belt; any app↔DB skew now yields a clean 422, never a raw 500.
2. **Active-per-RFQ 23505**: documented the "same RFQ ⇒ same fraction_contract_id ⇒ same advisory lock ⇒
   under-lock check already returned 409" invariant with an inline comment at the insert (the `.orIgnore`
   targets only `UQ_quotes_idem`, so this path is unreachable via code).
3. **softRemove ban**: `QuoteRepository.softRemove` is overridden to throw a clear domain error (rows are
   immutable; `fn_quotes_guard` blocks soft-delete) instead of letting a future caller hit a raw DB 500.
Integration test added for the softRemove ban. Build 0; quote unit 26 / integration 14 / e2e 16 green.

## Technical Details
- Affected: `quotes.service.ts` (validity re-check / catch mapping), `quote-repository.interface.ts` +
  `quote.repository.ts` (softRemove ban). No schema change.

## Acceptance Criteria
- [x] The clock-skew `CHK_quotes_validity` path yields a 422 (caught 23514 → QUOTE_RFQ_EXPIRED), not a 500.
- [x] The "same-RFQ ⇒ same-contract ⇒ same-lock" invariant behind orIgnore is documented at the insert.
- [x] `softRemove` on `Quote` is overridden to throw a clear domain error (integration-tested).

## Work Log
- 2026-08-22: Filed from PR #48 review (security-sentinel P3-2, data-integrity-guardian P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
