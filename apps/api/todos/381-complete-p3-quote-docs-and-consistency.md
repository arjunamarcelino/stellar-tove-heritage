---
status: complete
priority: p3
issue_id: 381
tags: [code-review, documentation, consistency, tov-175, pr-48]
dependencies: []
---
# Docs & consistency notes for the quote subtree (PR #48)

## Problem Statement
A few documentation / cross-reference gaps and one intentional-but-undocumented divergence. None affect
behavior; all reduce future-maintainer confusion.

## Findings
Source: architecture-strategist (P3 ×3).
1. **`src/modules/CLAUDE.md` not updated for the new `quotes/` subtree.** The `marketplace/` bullet (line ~57)
   documents `rfqs/` and `notifications/` in detail but omits `quotes/`, unlike every other subtree in that
   file. → add a `quotes/` clause: neutral `QuotesModule` / public `PublicQuotesModule` split, the `rfq_quotes`
   table (migration 044), and the hard fail-closed free-balance gate under the per-`(holder, token)` advisory
   lock.
2. **Two controllers share the `marketplace/rfqs` base path across two modules.** `quotes.controller.ts:12`
   (`@Controller('marketplace/rfqs')` + `@Post(':id/quotes')`) and `rfqs.controller.ts:17`
   (`@Controller('marketplace/rfqs')` + `@Post()`) — no collision, and it mirrors the shipped offering-bids
   precedent, but resource ownership is now split. → add a cross-reference comment on each controller noting the
   shared base path lives in a sibling module (as the bids controllers do).
3. **Wallet-resolution method diverges from the bids/RFQ precedent.** `quotes.service.ts:230` uses
   `walletsService.resolvePrimarySettlementAddress(userId)` (the TOV-237 holdings pattern), whereas
   `rfqs/rfq-balance.advisor.ts:35` and `offerings/bids/offering-bids.service.ts:565` use
   `resolveEmbeddedWalletForUser`. For a quote (balance read only, no signing leg) the primary-settlement wallet
   is defensible — but it means the free-balance gate reads a *different* wallet than an RFQ/bid flow would. If a
   holder's fractions sit in an embedded-passkey wallet that is not their primary settlement wallet, the gate
   reads the wrong balance. → confirm this is intentional (the wallet the holder will settle the sale from) and
   document the divergence; otherwise align with the bids precedent.

## Proposed Solutions
### Option A — Document all three (Recommended)
- Update `src/modules/CLAUDE.md`; add controller cross-ref comments; add a one-line rationale comment at
  `quotes.service.ts:230` on the primary-settlement-wallet choice.
- Pros: closes the doc gaps; makes the wallet choice explicit. Cons: none.
- Effort: Small · Risk: None
### Option B — Also reconcile the wallet-resolution choice
- If the intended sell-source wallet is the embedded/passkey wallet (to match how bids read balance), switch to
  `resolveEmbeddedWalletForUser`; else keep primary-settlement and document.
- Pros: guarantees the gate reads the wallet the holder will actually transfer from at settle. Cons: needs a
  product decision on which wallet FR-06.04 settles from.
- Effort: Small · Risk: Low (behavior change if switched)

## Recommended Action
Option A now (document). Track the wallet-resolution decision (Option B) against FR-06.04 accept-and-settle,
which pins which wallet the fractions actually transfer from.

## Resolution (2026-08-22, complete — docs + Option B for the wallet)
1. **CLAUDE.md** — added a `quotes/` clause to the `marketplace/` bullet in `src/modules/CLAUDE.md`
   (neutral/public split, `rfq_quotes` table, the hard fail-closed free-balance gate, embedded-wallet source,
   advisory lock + lazy-reap, migration 044).
2. **Controller cross-refs** — added a comment on both `quotes.controller.ts` and `rfqs.controller.ts` noting
   the shared `marketplace/rfqs` base path lives across two sibling modules (no collision; mirrors bids).
3. **Wallet-resolution** — reconciled (chose Option B): the gate now reads the holder's **embedded passkey
   wallet** via `resolveEmbeddedWalletForUser` (mapping `EmbeddedWalletNotFoundError` → 422
   `QUOTE_NO_SETTLEMENT_WALLET`), matching the bids/RFQ money paths and the FR-06.04 sell source — instead of
   `resolvePrimarySettlementAddress`. Behavior change; documented inline. Build 0; quote unit 26 / e2e 15 green.

## Technical Details (as-built)
- `src/modules/CLAUDE.md` (marketplace bullet), `quotes.controller.ts` + `rfqs.controller.ts` (comments),
  `quotes.service.ts` (`resolveEmbeddedWalletForUser` + `EmbeddedWalletNotFoundError` mapping + JSDoc),
  `test/unit/.../quotes.service.spec.ts` (mock switched to `resolveEmbeddedWalletForUser`).

## Technical Details
- Affected: `src/modules/CLAUDE.md`, `quotes.controller.ts`, `rfqs.controller.ts` (comments), `quotes.service.ts`
  (comment). No behavior change under Option A.

## Acceptance Criteria
- [x] `src/modules/CLAUDE.md` documents the `quotes/` subtree.
- [x] Both controllers cross-reference the shared `marketplace/rfqs` base path.
- [x] The wallet choice is reconciled (switched to the embedded wallet, matching bids/FR-06.04) and documented.

## Work Log
- 2026-08-22: Filed from PR #48 review (architecture-strategist P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
