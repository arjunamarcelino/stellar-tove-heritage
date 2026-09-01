---
status: complete
priority: p2
issue_id: 301
tags: [code-review, test-coverage, quality]
dependencies: []
---
# No service-level unit test for OfferingBidsService — idempotency, error-mapping, and gate branches untested

## Problem Statement
The PR ships unit tests for the processor, bid-money, status constant, and relayer helpers, plus an e2e for the happy path and a few acceptance criteria — but there is NO unit test for the orchestration service, `OfferingBidsService`, where idempotency ordering, gating, and relayer error mapping actually live. The transfer sibling has such a spec (`test/unit/modules/wallets/transfer/wallet-transfer.service.spec.ts`), so the pattern and infrastructure already exist. Many correctness-critical branches are therefore untested.

## Findings
Untested branches in `src/modules/offerings/bids/offering-bids.service.ts`:
- Idempotency HTTP branches entirely untested: `replay` (returns stored body, :124-126), `in_flight` → 409 (:127-129), `mismatch` → 422 (:130-132).
- `mapRelayerError` paths (:325-343): `signature_required` / `signature_invalid`, and the `simulation_failed` / `transfer_failed` / `unavailable` / default fallback. Only `expired` is currently exercised (via e2e).
- Balance-read-THROW path (:305-308) — e2e only covers the low-balance case, not a read that throws.
- `assertBiddable` gates never hit: OFFERING_NOT_FOUND (:234), OFFERING_NOT_OPEN incl. `!escrowContractAddress` (:237), OFFERING_WINDOW_NOT_OPEN (:241), OFFERING_WINDOW_CLOSED (:244), BID_ABOVE_HIGH_PRICE (:252), count>float (:255), cost-ceiling (:271), `computeEscrowStroops` catch (:268).
- WALLET_NOT_FOUND / no-passkey (:281-283); `decodeBoundKey` malformed → BID_SIGNATURE_INVALID (:288-294); BID_ALREADY_ACTIVE service null → 409 mapping (:157-160).

## Proposed Solutions
### Option A — Add a dedicated service unit spec
- Description: Add `test/unit/modules/offerings/offering-bids.service.spec.ts` mirroring the transfer service spec — mock repos, relayer, idempotency, users, wallets, audit, and queue; cover every branch listed above.
- Pros: Fast, deterministic, isolates each branch; matches the established transfer-service pattern; catches regressions cheaply.
- Cons: Requires mocking the full collaborator set; some upfront harness setup.
- Effort: Medium
- Risk: Low

### Option B — Extend e2e coverage for the highest-value gaps
- Description: Add e2e cases for window/float/wallet-not-found/idempotency-mismatch instead of unit tests.
- Pros: End-to-end confidence through the real HTTP + DB path.
- Cons: Heavier and slower; cannot easily exercise relayer error-mapping and read-throw branches; more fragile.
- Effort: Medium
- Risk: Low-Medium

### Option C — Hybrid
- Description: Unit spec for error-mapping/idempotency/decode branches (Option A), plus a couple of e2e cases for the gate branches with the highest business value.
- Pros: Best coverage-per-effort balance.
- Cons: Two test surfaces to maintain.
- Effort: Medium
- Risk: Low

## Recommended Action

## Technical Details
- Reference spec to mirror: `test/unit/modules/wallets/transfer/wallet-transfer.service.spec.ts`.
- Collaborators to mock for the service: offering repo, bid repo, relayer port, idempotency service, users service, wallets service, audit service, BullMQ queue.
- Line references are against `src/modules/offerings/bids/offering-bids.service.ts` as of PR #41.

## Acceptance Criteria
- The listed branches (idempotency replay/in_flight/mismatch, all `mapRelayerError` paths, balance-read throw, every `assertBiddable` gate, wallet-not-found/no-passkey, malformed bound-key decode, BID_ALREADY_ACTIVE) are covered by tests.
- `yarn test` stays green.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Added `test/unit/modules/offerings/offering-bids.service.spec.ts` (20 tests, all deps mocked, no DB/RPC)
covering every branch the reviewer flagged:
- **prepare gates:** OFFERING_NOT_FOUND, OFFERING_NOT_OPEN, WINDOW_NOT_OPEN, WINDOW_CLOSED,
  BID_BELOW_LOW_PRICE / BID_ABOVE_HIGH_PRICE, BID_COUNT_EXCEEDS_FLOAT, BID_NOT_WHITELISTED, per-bid
  cost-ceiling, WALLET_NOT_FOUND, BID_INSUFFICIENT_BALANCE (+ amounts), balance-read-throws →
  BID_UNAVAILABLE, buildBid simulation_failed → BID_ESCROW_REJECTED, and the happy path (no DB write).
- **submit idempotency + error paths:** replay (returns stored body), in_flight (409), mismatch (422),
  BID_ALREADY_ACTIVE (409 + `fail()` releases the key, no `complete()`), malformed bound key →
  BID_SIGNATURE_INVALID, stale signature → BID_CHALLENGE_EXPIRED (no write), and the happy path
  (insert → complete → enqueue, no fail()).

20/20 green; lint clean.
