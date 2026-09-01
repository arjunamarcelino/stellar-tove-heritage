---
status: complete
priority: p3
issue_id: 314
tags: [code-review, simplicity, typescript, tov-158]
dependencies: []
---
# `mapCancelRelayerError` duplicates `mapRelayerError` (5 of 6 cases + the exhaustiveness switch identical)

## Problem Statement
`OfferingBidsService.mapCancelRelayerError` and `mapRelayerError` are near-identical `never`-exhaustive switches over `TransferErrorReason`. They differ only in the `simulation_failed`/`transfer_failed` target (`BID_CANCEL_REJECTED` vs `BID_ESCROW_REJECTED`) and the `unavailable`/default message + log label. ~25 duplicated lines including a second copy of the `never` exhaustiveness guard, so a newly-added `TransferErrorReason` must be handled twice.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:429-453` (mapCancelRelayerError) vs `555-579` (mapRelayerError) — line ranges approximate; both in the same file.
- Unlike the verifier fork (todo 315) this is pure HTTP error mapping — no golden-vector or security coupling — so extraction carries essentially no audit cost.

## Proposed Solutions
### Option A — One shared mapper parameterized by `{ rejectedCode, rejectedMessage, serviceLabel }`
- Description: Extract a single `mapRelayerErrorTo(err, { rejectedCode, rejectedMessage, serviceLabel })` helper; both surfaces call it. De-duplicates the `never` switch so a new reason is handled once.
- Pros: Removes ~25 lines + the duplicated exhaustiveness guard; single place to extend.
- Cons: Slightly less greppable per-surface (can't read one surface's full error contract in one function); couples both surfaces' wording to a shared table.
- Effort: Small
- Risk: Low

### Option B — Leave as-is
- Description: Accept the duplication for per-surface readability.
- Pros: Each surface's error contract is self-contained.
- Cons: Two copies of the exhaustiveness switch to keep in sync.
- Effort: —
- Risk: —

## Recommended Action
Option A — one shared parameterized mapper.

## Technical Details
Low-risk, optional cleanup. If done, keep a single exhaustive `never` guard in the shared helper.

## Acceptance Criteria
- One exhaustiveness switch over `TransferErrorReason` for both bid and cancel surfaces.
- Bid and cancel error codes/messages unchanged (BID_ESCROW_REJECTED vs BID_CANCEL_REJECTED preserved).

## Work Log
- 2026-08-20: created from PR #42 code-simplicity-reviewer review (Finding 2)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20)
Extracted `mapRelayerErrorTo(err, { rejectedCode, rejectedMessage, serviceMessage, logLabel })` holding the
single exhaustive `never`-switch. `mapRelayerError` (BID_ESCROW_REJECTED / "Bid service…") and
`mapCancelRelayerError` (BID_CANCEL_REJECTED / "Cancel service…") are now thin wrappers that pass their
surface-specific code/message. The duplicated exhaustiveness switch is gone — a new `TransferErrorReason` is a
compile error in ONE place. Bid and cancel error codes/messages are byte-unchanged. Build 0 issues, service
unit 32/32.
