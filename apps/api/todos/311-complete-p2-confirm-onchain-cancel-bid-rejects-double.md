---
status: complete
priority: p2
issue_id: 311
tags: [code-review, money-safety, smart-contract, verification, tov-158]
dependencies: [308]
---
# Confirm on-chain `cancel_bid` REJECTS a second cancel of an already-refunded bid (the last-line double-refund defense)

## Problem Statement
The backend's entire double-refund guarantee is defense-in-depth on top of the DB state machine, but two paths ultimately rely on the on-chain `OfferingEscrow.cancel_bid` reverting (not silently re-transferring) when called a second time on an already-canceled `bid_id`: (a) the deliberate self-heal (a `canceling` row whose refund landed-but-was-unobserved reverts to `escrowed` after signature expiry, then permits re-cancel), and (b) the post-enqueue revert race in todo 308. If the contract does NOT reject a second cancel, both become P1 on-chain double-refunds; if it does, they are (worse-case) state-drift requiring manual reconciliation.

## Findings
- Contract (`stellar-tove-heritage/apps/contracts/contracts/tove-offering-escrow/src/contract.rs`): `cancel_bid` guards `if !bid.active { return Err(Error::BidInactive); }` and (CEI) sets `bid.active=false` before the refund transfer — which STRONGLY suggests a second cancel hits `BidInactive` and reverts. This must be **verified on-chain**, not assumed from a source read, and pinned by a test.
- Backend reliance points: `src/modules/offerings/bids/cancel/offering-bid-cancel.processor.ts` (self-heal via `expired`/`transfer_failed` → `casCancelFailedBackToEscrowed`); todo 308 (revert-after-live race).

## Proposed Solutions
### Option A — Live-testnet smoke: double-cancel the same bid_id, assert the 2nd reverts
- Description: Behind `RELAYER_LIVE_TESTNET=1`, submit two `cancel_bid`s for the same escrowed bid; assert the first refunds and the second reverts with `BidInactive` (no second transfer). Record the result in the deploy runbook as a gating check before mainnet.
- Pros: Empirically closes the assumption the whole money-safety design rests on.
- Cons: Requires live-testnet plumbing (already gated infra exists for the golden-vector).
- Effort: Small
- Risk: Low

### Option B — Contract-team written confirmation + unit assertion against a recorded XDR
- Description: Get explicit confirmation from the contracts team and pin a recorded revert-XDR vector in a unit test.
- Pros: No live infra needed.
- Cons: Weaker than an actual on-chain exercise.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — cite the passing contract test as confirmation; gate the live-testnet double-cancel smoke in the runbook.

## Technical Details
This is a verification/documentation task, not a code change to this PR. It gates the money-safety claims for mainnet and directly bounds the severity of todo 308.

## Acceptance Criteria
- Documented, verified confirmation (ideally an on-chain smoke) that a second `cancel_bid` on an already-canceled bid reverts and moves no funds.
- The result is recorded in the deploy runbook as a mainnet-gating item.

## Work Log
- 2026-08-20: created from PR #42 security-sentinel review ("confirm outside this PR")

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42
- Contract: `stellar-tove-heritage/apps/contracts/contracts/tove-offering-escrow/src/contract.rs`

---

## Resolution (COMPLETE — 2026-08-20)
Confirmed at the contract-test level: `tove-offering-escrow/src/test.rs:320`
`cancel_inactive_bid_reverts_bid_inactive()` calls `cancel_bid` once (succeeds) then `try_cancel_bid` again on
the same id and asserts `Err(Ok(Error::BidInactive))` — i.e. a second cancel of an already-canceled bid
REVERTS and moves no funds (the CEI sets `bid.active=false` before the refund transfer, and the `!bid.active`
guard returns `BidInactive`). This is the last-line defense that bounds todo 308's severity (DB-chain
state-drift, NOT an on-chain double-spend) and underpins the ambiguous-revert self-heal.

The additional live-testnet double-cancel smoke is documented as a **mainnet gate** in the deploy runbook
(§8, added in todo 310): cancel the same bid twice on live testnet and assert the 2nd reverts `BidInactive`
with no second transfer. No backend code change required — this is a verification finding.
