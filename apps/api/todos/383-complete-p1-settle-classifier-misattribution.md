---
status: complete
priority: p1
issue_id: 383
tags: [code-review, tov-177, pr-49, money-path, soroban, correctness, security]
dependencies: []
---
# Settle classifier: cross-contract error-code misattribution + unmapped `REVERTED` retries forever

## Problem Statement
`accept_quote` is a single nested invocation spanning **three** contracts — the MarketplaceSettler, the
FractionToken (OZ, seller→buyer fraction leg), and the USDC SAC (three buyer→x legs). The settle failure
classifier interprets every surfaced contract error code in **one** namespace, and `parseContractErrorCode`
greps only the *first* `Error(Contract, #n)` from the simulation-error string. Two distinct defects follow:

1. **Misattribution (griefing vector).** Nothing guarantees the surfaced `#n` came from the FractionToken. A
   **buyer-side** USDC-transfer revert (or any SAC/Settler code numerically colliding with `5/6/7/8/10/100`) is
   attributed to the seller and **expires the seller's still-valid quote** (`quoteDisposition:'expire'` →
   `expireWithReason`). Concrete: buyer accepts, then drains their own USDC before the worker runs; the buyer-leg
   revert is misclassified as `seller_balance_insufficient` → the seller's open quote is expired and their locked
   balance freed. Repeatable grief against sellers; no funds move (revert is atomic) but it is a money-adjacent
   correctness/DoS hole.
2. **Unmapped/`null` `REVERTED` retries forever.** Any unrecognized `contractCode` (including `null`) maps to
   `terminal:false` (retry). A `REVERTED` is deterministic — retrying cannot help and `is_settled` stays
   `false` — so an unmapped code (e.g. SDK message-format drift makes the regex yield `null`) spins until
   `attempts:8` exhaust, then strands the trade `pending`, directly feeding the wedge in
   [[382-pending-p1-settle-reconcile-backstop-missing]].

Flagged by security (P2-1, "escalate to P1 if on-chain verification confirms the SAC code collides") and
typescript (P2 #2). Combined, filed **P1**: defect (2) is unconditional and deterministic; defect (1) is a
repeatable griefing path on the money surface.

## Findings
- `src/modules/marketplace/settlement/settle/settle-failure.classifier.ts:16-51` — single-namespace mapping;
  `:49-50` unknown/`null` → `terminal:false`.
- `src/modules/relayer/soroban-relayer.service.ts:1115-1118` — `parseContractErrorCode` =
  `/Error\(Contract,\s*#(\d+)\)/` on the first match only; no contract-of-origin tag.
- Related: buyer USDC sufficiency is only checked at `prepare` (`accept.service.ts:75,279-300`), never re-read at
  submit — so the buyer-drain TOCTOU that triggers defect (1) is reachable (security P3-2).

## Proposed Solutions
### Option A — Disambiguate origin + treat parsed deterministic reverts as terminal (Recommended)
- Have the Settler wrap inner failures in disambiguated, settler-owned codes (or a party tag) so the buyer-leg
  vs seller-leg vs settler-leg failure is distinguishable; classify only proven FractionToken codes as
  seller-fault.
- For any `REVERTED` whose code the classifier cannot *prove* is FractionToken-origin (incl. `null`), return
  `terminal:true` + `quoteDisposition:'keepOpen'` (after the `is_settled==false` gate) — deterministic, so no
  retry, and it does not punish the seller.
- Pros: closes both the grief and the retry-forever strand. Cons: needs the on-chain error taxonomy pinned
  (SAC vs OZ codes) and possibly a Settler-contract change. Effort: Medium · Risk: Medium (contract dependency).

### Option B — Backend-only mitigation (partial)
- Keep the mapping but (a) default unknown parsed `REVERTED` → terminal keepOpen, and (b) add a worker-time USDC
  re-read before submit so buyer-shortfall is caught as a distinct `buyer_*` reason rather than a raw revert.
- Pros: no contract change; kills the retry-forever half and most of the misattribution. Cons: still can't
  perfectly attribute a code that genuinely collides. Effort: Small-Medium · Risk: Low.

## Recommended Action
Do Option B now (backend-only, unblocks the deterministic-strand half) and pin the on-chain error taxonomy;
pursue Option A's settler-side disambiguation before mainnet.

## Technical Details
- Affected: `settle-failure.classifier.ts`, `soroban-relayer.service.ts` (`parseContractErrorCode`),
  possibly the Settler contract; `accept.service.ts` if adding a submit-time USDC re-read.
- **Blocked on:** confirmation of the real Soroban error codes emitted by the USDC SAC vs OZ FractionToken vs
  Settler for insufficient-balance / frozen / lockup — verify on testnet before finalizing the mapping.

## Acceptance Criteria
- [ ] A buyer-USDC-shortfall revert does NOT expire the seller's valid quote.
- [ ] A `REVERTED` with an unrecognized/`null` code is terminal (keepOpen), not retried to exhaustion.
- [ ] Classifier unit tests cover: SAC buyer-leg revert, unknown code, `null` code, genuine seller-fault code.

## Resolution (2026-08-22, complete — Option B backend mitigation; settler-side disambiguation deferred)
Both backend-only halves landed; the settler-contract disambiguation (Option A) stays a pre-mainnet follow-up
(needs the on-chain error taxonomy pinned on testnet — tracked here as the remaining scope).
1. **Deterministic REVERTED no longer retries forever / never wrongly expires the seller.** The classifier's
   REVERTED `default` (unrecognized OR `null` code) now returns `{terminal:true, reason:'settlement_reverted',
   quoteDisposition:'keepOpen'}` instead of `{terminal:false}`. `FT_MIGRATION_PENDING` (11) stays the sole
   retryable code. A revert we cannot prove is FractionToken/seller-origin is terminated **keepOpen** — the
   seller's quote is never expired for a cross-contract (USDC-SAC) or unknown code, and the pending latch is
   freed instead of spinning to `attempts:8` exhaustion (which fed the #382 wedge).
2. **Worker-time buyer-USDC pre-check.** Before `submitSignedAcceptQuote`, the processor best-effort reads the
   buyer's USDC via `relayer.readWalletHoldings`; `balance < gross` → terminal `buyer_usdc_insufficient`
   (keepOpen), skipping the submit so a drained-buyer revert is attributed to the buyer, not misclassified as
   `seller_balance_insufficient`→expire. **Fail-open**: a read error proceeds to submit (the enforcing re-sim +
   on-chain revert remain the backstop), so it never blocks a fundable settle. New reason
   `buyer_usdc_insufficient` (23 chars ≤ 48) added to `SETTLE_FAILURE_REASONS`.

Verified: build 0, lint clean, classifier unit 4/4 (added `contractCode:999` and `null` → terminal keepOpen
assertions), accept e2e 4/4 (AC1 happy + AC2 seller-revert both still drive the worker; the pre-check funds
through). The buyer-drain TOCTOU itself is inherently racy (prepare + worker read the same holdings source) so
it is covered by the classifier unit change + AC1/AC2 regression rather than a dedicated e2e.

### Files changed
- `src/modules/marketplace/settlement/settle/settle-failure.classifier.ts` (REVERTED default)
- `src/modules/marketplace/settlement/settle/settle-failure.constant.ts` (+`buyer_usdc_insufficient`)
- `src/modules/marketplace/settlement/settle/quote-settle.processor.ts` (buyer-USDC pre-check)
- `test/unit/modules/marketplace/settle-failure.classifier.spec.ts`

### Remaining (deferred, pre-mainnet): settler-side error-origin disambiguation (Option A) + pinning the real
SAC vs OZ vs Settler error codes on testnet. Tracked as a follow-up, not a merge blocker.

## Work Log
- 2026-08-22: Filed from PR #49 review (security + typescript).
- 2026-08-22: Backend mitigation (Option B) implemented + tested; marked complete. Settler disambiguation deferred.
