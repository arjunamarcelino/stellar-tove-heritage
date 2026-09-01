---
status: complete
priority: p2
issue_id: 297
tags: [code-review, security, money]
dependencies: []
---
# On-chain idempotency_key (submit_bid args[3]) is not exact-pinned to the server-derived value

## Problem Statement
`verifyBidAuthorization` checks that `args[3]` is a `BytesN<32>` but never asserts it equals `deriveOnChainIdemKey(offeringId, collectorSub, httpKey)`. A client can therefore bake any 32 bytes into the signed transaction, decoupling the DB dedupe belt (`UQ_offering_bids_idem`) and the contract's on-chain `DuplicateBid` guard from the server's intended value. This is not a double-spend today — it is bounded by `UQ_offering_bids_active_per_collector` plus the on-chain nonce — but it removes a defense-in-depth layer the design explicitly intends. Related: the DB `idempotency_hash` (re-derived at submit) and the tx's baked idem can also diverge if the client uses different `Idempotency-Key` headers on `/prepare` vs `/submit`.

## Findings
- `src/modules/relayer/bid-authorization.ts:134-136` — `args[3]` is validated as a `BytesN<32>` only; there is no equality check against the server-derived idem. Scenario: a client bakes arbitrary 32 bytes into the signed tx; the verifier accepts it, so the on-chain `DuplicateBid` guard keys on a value the server never chose.
- `src/modules/offerings/bids/bid-idempotency.ts:5` — the module comment states it "ties the HTTP idempotency scope to the contract's DuplicateBid guard end to end", an invariant the current verifier does not actually enforce.
- `src/modules/offerings/bids/offering-bids.service.ts:82` — `/prepare` bakes the idem into the tx to be signed; `:146` / `:155` — `/submit` re-derives the DB hash. If the client sends different `Idempotency-Key` headers across the two calls, the baked value and the re-derived value diverge.

## Proposed Solutions

### Option A — Thread server-derived idem into the verifier and require equality
Description: Pass the server-derived `idemHash` into `verifyBidAuthorization` and add `requireBytesEqual(args[3], expectedIdemHash)`, exactly the way `price` and `count` are already pinned.
Pros: Restores the intended end-to-end tie; smallest surface; mirrors the existing pinning pattern for the other args.
Cons: Requires the caller to compute and pass the expected idem before verification.
Effort: Small.
Risk: Low.

### Option B — Verify DB hash against tx-parsed idem + require stable key across prepare/submit
Description: At submit, parse the idem out of the signed `txXdr` and verify it against the DB `idempotency_hash`; require (and document) that the same `Idempotency-Key` header is used across `/prepare` and `/submit`.
Pros: Also closes the prepare/submit header-divergence gap.
Cons: More parsing logic; a documented-only requirement is weaker than an enforced equality check.
Effort: Small.
Risk: Low-Medium.

## Recommended Action

## Technical Details
The expected value is `deriveOnChainIdemKey(offeringId, collectorSub, httpKey)`. `requireBytesEqual` should compare the 32-byte `BytesN` scval against the server-computed buffer, matching how `price`/`count` are already asserted in `bid-authorization.ts`. Options A and B are complementary — A pins the verifier, B additionally closes the prepare→submit header divergence.

## Acceptance Criteria
- A tx whose `args[3]` != the server-derived idem is rejected by the verifier.
- A unit test covers the rejection.
- The same-key-across-prepare/submit requirement is documented or enforced.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

`verifyBidAuthorization` now EXACT-pins `submit_bid` args[3] to the server-derived on-chain idem key,
alongside the existing price/count/inner-amount pins:
- `VerifyBidAuthorizationInput.expectedIdemKey` added; the verifier asserts `args[3].bytes()` equals it.
- Threaded server-side: `SubmitSignedBidInput.idempotencyKey` (port) → carried in the BullMQ job payload
  (`OfferingBidEscrowJob.idempotencyKey`, base64url) → decoded by the processor → passed to
  `submitSignedBid` → into `verifyBidAuthorization`. The value is the same `deriveOnChainIdemKey(offeringId,
  collectorSub, httpKey)` the service bakes at `/prepare` and stores as `idempotency_hash`.

Now the DB dedupe belt (`UQ_offering_bids_idem`), the on-chain `DuplicateBid` guard, and the HTTP
idempotency scope all key on the SAME value — a client can no longer bake arbitrary 32 bytes.

**Tests:** new bid-authorization unit test (mismatched idem → reject); processor job carries the key; the
e2e proves the end-to-end pin (prepare bakes → submit → worker verifies). 19 unit + 7 e2e green; build green.
