---
status: complete
priority: p3
issue_id: 391
tags: [code-review, tov-177, pr-49, type-safety, data-integrity, provenance]
dependencies: []
---
# Money-record & type-fidelity nits (provenance, precision drift, unchecked cast, loose typing)

## Problem Statement
Small correctness/fidelity items on the money record and its types. Individually minor; grouped for one cleanup
pass.

## Findings
1. **Adopt path stamps `tx_hash = NULL` permanently.** `quote-settle.processor.ts:54/80/86` call
   `persist(trade, null)` on the self-heal/adopt branches; `casSettled` (`secondary-trade.repository.ts:78`)
   sets `tx_hash=NULL`, and `fn_secondary_trades_guard` (migration `:169-171`) makes `tx_hash` write-once. So an
   adopted settlement can NEVER carry its confirming hash — a provenance gap on the money record, and
   `secondary-trade.entity.ts:70` ("Present only when settled") becomes inaccurate. → Either document the gap, or
   relax the guard to allow a one-time `NULL→value` backfill (a reconciler, 382, could then stamp the real hash).
   (data-integrity P3.)
2. **Entity/DB shape drift on `gross_stroops`.** `secondary-trade.entity.ts:52-61` declares `precision:39,
   scale:0`, but the DB column is deliberately **unbounded** `numeric` (migration `:96`) so the i128 CHECK — not
   a numeric-precision overflow (`22003`) — is what rejects. Cosmetic under `synchronize:false` (read as string),
   but the annotation misleads. → Align/annotate the entity to reflect the unbounded column. (data-integrity nit.)
3. **Unchecked `as Buffer` cast on crypto material.** `accept.service.ts:172`
   `(ctx.quote.sellerAuthEntry as Buffer).toString('base64')` — `sellerAuthEntry` is `Buffer | null`; the cast
   silently drops null. Safe today only because `findAcceptable` filters `seller_auth_entry IS NOT NULL`, but a
   null here throws a raw 500 mid-enqueue. → Explicit guard, or thread the non-null value through the typed
   context. (typescript P3.)
4. **Loose response typing.** `TradeResponseDto.status` is typed `string` (`accept-response.dto.ts:36`) instead
   of the `SecondaryTradeStatus` union, losing exhaustiveness. Consistent with the existing bids/quotes pattern,
   so low priority. → Narrow to the union. (typescript P3.)
5. **`seller_auth_entry bytea` has no length cap.** Unlike `idempotency_key_hash` (`CHK_..._idem_len=32`), the
   stored `SorobanAuthorizationEntry` XDR is unbounded at the DB. Not a money-integrity issue (DTO caps at
   `MaxLength(8192)`), but there's no DB belt. → Optional `octet_length` ceiling. (migration P3.)

## Proposed Solutions
### Option A — Sweep all five in one small PR (Recommended)
- Guard/thread the `sellerAuthEntry` non-null (3); narrow `TradeResponseDto.status` to the union (4); correct
  the `gross_stroops` entity annotation (2); document the `tx_hash=NULL`-on-adopt behavior on the entity (1, or
  relax the guard if 382 will backfill); optionally add the `octet_length` cap (5).
- Effort: Small · Risk: Low.

## Recommended Action
Option A. Decide (1) alongside [[382-pending-p1-settle-reconcile-backstop-missing]] — if the reconciler will
stamp the real hash on adopt, relax the write-once guard to permit `NULL→value`; otherwise just document.

## Technical Details
- Affected: `quote-settle.processor.ts`, `secondary-trade.repository.ts`, `secondary-trade.entity.ts`,
  `accept.service.ts`, `accept-response.dto.ts`, migration 045 (guard/`octet_length`, only if changing).

## Acceptance Criteria
- [ ] No `as Buffer` on nullable crypto material (explicit guard or typed non-null).
- [ ] `TradeResponseDto.status` typed as `SecondaryTradeStatus`.
- [ ] `gross_stroops` entity annotation matches the unbounded DB column.
- [ ] `tx_hash`-on-adopt behavior is either documented or backfillable.

## Resolution (2026-08-22, complete)
1. **`tx_hash`-on-adopt** — corrected the entity comment: a `settled` trade adopted via `is_settled` (self-heal
   or reconcile) legitimately has `tx_hash = NULL`, and the write-once guard permits a later NULL→value
   backfill, so the column is NOT proof of "not settled". Documented (guard already allows the future backfill;
   no DDL change).
2. **`gross_stroops` precision drift** — NON-ISSUE (reviewer misread): the entity's `gross_stroops` `@Column`
   already has NO `precision/scale` (unbounded `numeric`), matching the DB. No change.
3. **Unchecked `as Buffer` cast** — replaced with an explicit `sellerEntry` guard in `accept.service` (a null
   `seller_auth_entry` now maps to a clean `422 ACCEPT_QUOTE_NOT_ACCEPTABLE` instead of a raw 500 mid-enqueue).
4. **Loose `TradeResponseDto.status`** — narrowed from `string` to the `SecondaryTradeStatus` union.
5. **`seller_auth_entry` length cap** — DEFERRED (optional): the DTO already bounds the entry at
   `MaxLength(8192)`; a DB `octet_length` belt is not a settlement-safety concern and is out of scope here.

Verified: build 0, lint clean, accept e2e 4/4.

### Files changed
- `src/modules/marketplace/settlement/entities/secondary-trade.entity.ts` (tx_hash comment)
- `src/modules/marketplace/settlement/accept/accept.service.ts` (explicit sellerEntry guard)
- `src/modules/marketplace/settlement/accept/dto/accept-response.dto.ts` (status union)

## Work Log
- 2026-08-22: Filed from PR #49 review (data-integrity + typescript + migration).
- 2026-08-22: Fixed tx_hash comment, `as Buffer` cast, status typing; gross-drift a non-issue; length-cap deferred; complete.
