---
status: complete
priority: p3
issue_id: 389
tags: [code-review, tov-177, pr-49, correctness, observability, money-path]
dependencies: []
---
# Seller-signature expiry is recorded as a buyer fault; `seller_auth_lapsed` reason is dead

## Problem Statement
`submitSignedAcceptQuote` returns `RELAYER_FAILED reason:'expired'` when **either** the buyer OR the seller
signature has lapsed, but the classifier maps `'expired'` unconditionally to `'buyer_signature_expired'`.
Meanwhile `'seller_auth_lapsed'` is declared in `SETTLE_FAILURE_REASONS` but never produced. So a lapsed
**seller** auth is persisted as a **buyer** fault — misleading for ops/forensics on a money surface, and the
intended seller reason is unreachable dead code.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:1037-1041` — single `'expired'` reason for either party.
- `src/modules/marketplace/settlement/settle/settle-failure.classifier.ts:55-56` — `'expired'` →
  `'buyer_signature_expired'` unconditionally.
- `src/modules/marketplace/settlement/settle/settle-failure.constant.ts:8` — `'seller_auth_lapsed'` declared,
  never emitted (only appears in a `quote.entity.ts:52` JSDoc example).

## Proposed Solutions
### Option A — Distinguish the two expiries at the relayer, map each in the classifier (Recommended)
- Have `submitSignedAcceptQuote` return distinct reasons (`'buyer_sig_expired'` vs `'seller_auth_lapsed'`) based
  on which entry's `expiresAtLedger` is past; classifier maps `seller_auth_lapsed` → `quoteDisposition:'expire'`
  (the seller must re-authorize) and buyer-sig-expired → `keepOpen` (buyer re-prepares).
- Pros: correct forensics + drives the right quote disposition. Cons: needs the relayer to expose which entry
  lapsed. Effort: Small · Risk: Low.

### Option B — Drop the dead literal
- If the two cannot be distinguished cheaply, remove `'seller_auth_lapsed'` from the reason set and rename
  `'buyer_signature_expired'` to a party-neutral `'signature_expired'`.
- Effort: Small · Risk: Low (loses the seller/buyer distinction).

## Recommended Action
Option A — the disposition differs by party (seller-lapse should expire the quote so the seller re-signs), so the
distinction is behaviorally meaningful, not just cosmetic.

## Technical Details
- Affected: `soroban-relayer.service.ts` (`submitSignedAcceptQuote`), `settle-failure.classifier.ts`,
  `settle-failure.constant.ts`. Coordinate with [[383-pending-p1-settle-classifier-misattribution]].

## Acceptance Criteria
- [ ] A lapsed seller auth is recorded with a seller-specific reason and expires the quote.
- [ ] A lapsed buyer sig keeps the quote open (buyer re-prepares).
- [ ] No unreachable literal remains in `SETTLE_FAILURE_REASONS`.

## Resolution (2026-08-22, complete — Option A)
The `AcceptQuoteOutcome` RELAYER_FAILED variant gained an optional `expiredParty?: 'buyer' | 'seller'`.
`submitSignedAcceptQuote`'s two-entry expiry check now computes `sellerExpired`/`buyerExpired` separately and
sets `expiredParty` (seller takes precedence when both lapsed — re-authorize is the superset recovery). The
classifier's `'expired'` case now returns `seller_auth_lapsed`/`expire` when `expiredParty==='seller'` (the
seller must re-authorize) and `buyer_signature_expired`/`keepOpen` otherwise — wiring the previously-dead
`seller_auth_lapsed` reason and giving ops the correct party for forensics + the correct quote disposition.

Verified: build 0, lint clean, classifier unit 5/5 (added seller-lapse → expire and explicit buyer-lapse
assertions), relayer accept round-trip 5/5 + accept-authorization 13/13 unchanged.

### Files changed
- `src/modules/relayer/relayer.service.interface.ts` (`expiredParty` on the outcome)
- `src/modules/relayer/soroban-relayer.service.ts` (per-party expiry)
- `src/modules/marketplace/settlement/settle/settle-failure.classifier.ts` (`'expired'` case)
- `test/unit/modules/marketplace/settle-failure.classifier.spec.ts`

## Work Log
- 2026-08-22: Filed from PR #49 review (typescript + simplicity).
- 2026-08-22: Fixed via Option A; tests green; marked complete.
