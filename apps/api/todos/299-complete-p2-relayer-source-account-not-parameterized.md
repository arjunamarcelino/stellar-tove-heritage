---
status: complete
priority: p2
issue_id: 299
tags: [code-review, performance, architecture, scalability]
dependencies: []
---
# Relayer source account + lock key are not parameterized — a channel-account pool is a rewrite, not config

## Problem Statement
`SorobanRelayerService` holds a single `Keypair` and derives a single lock key `relayer:account:${pubkey}`. `submitSignedBid`'s input carries no source/channel selector. Adding a channel-account pool — the fix for the throughput cliff tracked in todo 295 — therefore requires refactoring account management: load N keypairs, select one per job, use a lock-key-per-channel, raise processor concurrency, and thread a channel id through the job payload and the port. The author NOTE in the adapter already acknowledges this deferral. It is flagged now because the throughput cliff will force this change under production pressure, when the refactor is most expensive.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts` — a single `this.relayer = Keypair.fromSecret(...)` (~line 141); the lock key is hardcoded as `relayer:account:${this.relayer.publicKey()}` (~:405-407 in the transfer path, ~:621-623 in the bid path); the NOTE at ~:566-572 defers the sequence-rebuild / channel-pool work. Scenario: under sustained bid load, all jobs serialize on one account's single lock and one sequence number, capping throughput at ~1 tx/account/ledger.
- `src/modules/relayer/relayer.service.interface.ts` — `SubmitSignedBidInput` has no source/channel field, so a caller cannot select a channel account without changing the port.

## Proposed Solutions

### Option A — Parameterize source account + lock key now
Description: Thread an optional `sourceAccount` / `lockKey` through the port (`SubmitSignedBidInput`) and the adapter, so a future channel-account pool is purely additive on top of verify/simulate/send rather than a rewrite of those paths.
Pros: Makes the pool an additive change later; isolates the churn to input plumbing while the code is fresh; de-risks the eventual scaling fix.
Cons: Adds plumbing before the pool actually exists; optional fields must default to today's single account.
Effort: Medium.
Risk: Low.

### Option B — Defer entirely, document the refactor cost
Description: Leave the single-account design as-is but document the refactor scope and the scaling risk explicitly against todo 295.
Pros: No code change now.
Cons: The cliff still lands mid-rewrite under production pressure; the cost is only recorded, not reduced.
Effort: Small.
Risk: Medium.

## Recommended Action

## Technical Details
The three internal steps (verify, simulate, send) all currently assume `this.relayer` and the single lock key. Parameterizing means each step reads a per-job source keypair and its derived lock key `relayer:account:${channelPubkey}`. A pool then only needs: load N keypairs, select per job, and set processor concurrency > 1 — no change to verify/simulate/send logic. See the deferral NOTE at `soroban-relayer.service.ts:~566-572`.

## Acceptance Criteria
- Either the source keypair + lock key are parameterizable (a channel-account pool can be added without touching verify/simulate/send), or
- the scaling risk and full refactor scope are documented against todo 295.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20 — documented defer)

**Decision (confirmed with the maintainer):** defer the source-account/lock-key parameterization to the
same follow-up ticket as the channel-account pool (todo 295). Rationale: parameterizing now is speculative
(YAGNI) with no pool consumer, and the pool + submit/confirm decoupling need load / live-testnet validation
that isn't available here. No code change in this pass.

**Documented as the known scaling posture:**
- The relayer holds one `Keypair` and one lock key `relayer:account:${pubkey}` (see the existing NOTE in
  `soroban-relayer.service.ts` `submitSignedBid`). All passkey-signed money flows (transfer/export/bid)
  serialize on this shared account/lock — an operational SLO of ~1 tx/ledger (~0.2 TPS) system-wide.
- The mitigation shipped now (todo 295: wider `BID_SIG_VALIDITY_LEDGERS`) buys headroom against in-queue
  expiry; the real horizontal fix (a funded channel-account pool + threading an optional
  `sourceAccount`/`lockKey` through the port so it's additive to verify/simulate/send) is the tracked
  follow-up. Monitor queue depth + relayer XLM balance (todo 302) until then.

Marked complete as **documented/deferred** (no code change); the refactor scope is recorded against todo 295.
