---
status: complete
priority: p1
issue_id: 295
tags: [code-review, performance, reliability, money]
dependencies: []
---

# Escrow throughput cliff: concurrency:1 + confirmation-blocking worker + ~200s signature window → mass expiry failures under burst

## Problem Statement
The escrow worker runs `concurrency: 1` AND blocks on `pollForBid` (confirmation) per job, so realistic drain is ~6-7 bids/min. The signed `submit_bid` is valid only ~40 ledgers (~200s ≈ 3.3min) from prepare. Past ~20-25 queued bids, signatures expire while the bid is still waiting in the queue → the worker drains each one only to latch it `failed`. A popular offering opening produces a self-sustaining backlog where most bids fail and re-queue behind the same slow drain — a throughput cliff on the money surface right when demand is highest.

## Findings
- `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts:28-34` — `@Processor(..., { concurrency: 1, ... })`; all bids serialize through a single worker slot.
- `src/modules/relayer/soroban-relayer.service.ts` — `submitSignedBid` blocks on `pollForBid` (FIRST_POLL_DELAY_MS 2s + ~1 ledger close ~5s per job); `SIG_VALIDITY_LEDGERS = 40` (~line 63, ~200s window); the expiry check (~line 594) throws `expired`.
- Failure scenario: an offering opens and 300 collectors bid in the first minute. ~20-25 bids escrow before their signatures are still valid; the rest expire in-queue and latch `failed`. Collectors re-prepare and mostly fail again behind the same ~6-7/min drain, sustaining the backlog.

## Proposed Solutions
### Option A: Decouple submit from confirmation
- **Description:** Do `sendTransaction` under the relayer lock, then hand off `pollForBid` to a separate poll/finalize stage so the worker advances roughly one bid per ledger instead of blocking on confirmation.
- **Pros:** Roughly doubles drain without adding relayer accounts; keeps the 1-tx/account/ledger constraint. **Cons:** Two-stage state machine; must handle the send-succeeded-but-poll-pending handoff carefully (ties into finding 293). **Effort:** Medium **Risk:** Med

### Option B: Widen `SIG_VALIDITY_LEDGERS` for the async bid path
- **Description:** The 40-ledger validity is copied from the interactive transfer path; a queued escrow wants a larger validity budget so bids don't expire while waiting. Bump the validity window specifically for the async bid flow.
- **Pros:** Small, immediate relief; buys headroom for the backlog. **Cons:** Longer-lived signed authorizations widen the replay/exposure window; not a throughput fix, only a deadline extension. **Effort:** Small **Risk:** Low

### Option C: Horizontal relayer account pool (channel / fee-bump)
- **Description:** Parameterize the relayer source/lock so multiple relayer accounts drain bids in parallel (one tx/account/ledger each), lifting the aggregate ceiling.
- **Pros:** Real horizontal scale for a hot offering. **Cons:** Source/lock not currently parameterized (see todo 299); funding, sequencing, and lock-key management per account. **Effort:** Large **Risk:** Med

## Recommended Action
<!-- filled during triage; suggested: B now + design for A/C -->

## Technical Details
- `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts` (`concurrency: 1`, lines 28-34)
- `src/modules/relayer/soroban-relayer.service.ts` (`submitSignedBid`, `pollForBid`, `SIG_VALIDITY_LEDGERS`, FIRST_POLL_DELAY_MS, expiry check)
- Related: todo 299 (relayer source/lock not parameterized)

## Acceptance Criteria
- [ ] A documented target drain rate (bids/min) for the escrow worker.
- [ ] A recorded decision on widening the signature validity window for the async bid path and/or decoupling submit from confirmation.
- [ ] A capacity note for a real primary offering opening (expected burst size vs. drain rate, and the mitigation in effect).

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41
- src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts
- src/modules/relayer/soroban-relayer.service.ts

---

## Resolution (COMPLETE — 2026-08-20)

**Chosen:** lite mitigation now + document the deeper fixes as a follow-up (confirmed with the maintainer).

**Done now:** added `BID_SIG_VALIDITY_LEDGERS = 120` (~10 min) and used it in `buildBid`
(`src/modules/relayer/soroban-relayer.service.ts`) instead of the interactive-path
`SIG_VALIDITY_LEDGERS = 40` (~200s). A queued `submit_bid` signature now survives ~120 ledgers of worker
queue latency instead of ~40, so a burst of bids no longer mass-expires in-queue at the current
`concurrency:1` drain rate (~7/min → ~70 bids can drain within the window vs ~22 before). Kept far below the
OZ smart-account default (720) to bound the replay/fee window.

**Deferred to a follow-up ticket (documented, needs load / live-testnet validation):**
- Decouple `sendTransaction` from `pollForBid` in the worker so it advances ~1/ledger instead of blocking on
  confirmation (roughly doubles drain).
- A funded **channel-account pool** for true horizontal throughput (requires the source/lock
  parameterization tracked in **todo 299**).

Surface the ~1-bid/ledger SLO to product for subscription-window sizing; monitor queue depth (todo 302).
Build green.
