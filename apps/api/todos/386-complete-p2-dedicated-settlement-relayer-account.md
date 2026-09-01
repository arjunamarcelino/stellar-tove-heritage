---
status: complete
priority: p2
issue_id: 386
tags: [code-review, tov-177, pr-49, performance, scalability, relayer, soroban]
dependencies: []
---
# Dedicated marketplace-settlement relayer source account (throughput ceiling C1)

## Problem Statement
`submitSignedAcceptQuote` takes the **same** `relayer:account:${pubkey}` send-lock that already serializes
passkey USDC transfers, embedded-wallet deploys, offering-bid submits, and bid cancels. One keypair = one
sequence number, and the lock releases at `sendTransaction` (before ledger-apply), so the effective ceiling is
**~1 tx per ledger-close ≈ 0.2 tx/s ≈ 12 tx/min shared across ALL of those surfaces**. p99 accept→settled
latency is therefore coupled to total relayer-account load, not marketplace load: under contention a settle
queues behind every other relayer op, and with `attempts:8` + exponential backoff a settle that keeps losing the
`txBadSeq` race can take minutes while the buyer sees `pending`.

The performance agent rated this **P1**; filed here as **P2** because it is a throughput/ops-SLO concern (not a
correctness or merge-blocking defect) and is already a documented deferred follow-up. Raising worker
`concurrency` above 1 would **not** help — it would produce `txBadSeq` storms on the shared sequence; the shared
source account is the bottleneck, not `concurrency:1`.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:~1072` — lock key `relayer:account:${this.relayer.publicKey()}`,
  shared with `submitSignedTransfer` / `deployPasskeyWallet` / `submitSignedBid` / `submitSignedCancelBid`.
- `src/modules/marketplace/settlement/settle/quote-settle.processor.ts:31` — `concurrency:1`.
- Precedent: `offerings/settle/offering-settle.processor.ts:~92` uses a **dedicated**
  `relayer:offering-escrow:account` lock, so offering settlements never contend with the fleet.
- Fix already self-documented: `marketplace-settlement.config.ts:6-8` and the relayer header comment
  (`soroban-relayer.service.ts:~854`) name the "dedicated marketplace-settlement source account" as the C1
  follow-up.

## Proposed Solutions
### Option A — Dedicated source account + own lock key (Recommended)
- Provision a separate settlement keypair (config + secret), submit `accept_quote` from it under a
  `relayer:marketplace-settlement:account` lock, mirroring the offering-escrow account. Ensure it is funded and
  KYC/allowlist-irrelevant (it's only the tx source/fee-payer; the buyer/seller entries carry the auth).
- Pros: decouples settlement throughput from the bid/transfer/deploy fleet. Cons: another funded account +
  secret to operate. Effort: Medium · Risk: Low.

### Option B — Ship as-is, size ops alerts to the shared ~12 tx/min ceiling
- Document the shared-account SLO and alert on settle-queue depth / age. Cons: settlement latency stays coupled
  to unrelated relayer traffic. Effort: Small · Risk: Medium under load.

## Recommended Action
Option A when marketplace accept volume approaches a meaningful share of the shared ~12 tx/min budget; Option B's
alerting in the interim.

## Technical Details
- Affected: `soroban-relayer.service.ts`, `marketplace-settlement.config.ts`, `validation-schema.ts`
  (new secret/address — see [[387-pending-p2-settlement-config-bypasses-joi]]), deploy/secrets.

## Acceptance Criteria
- [ ] `accept_quote` submits under a settlement-specific lock; a burst of bids/transfers does not stall settles.
- [ ] The settlement account funding + secret handling matches the offering-escrow account pattern.

## Resolution (2026-08-22, complete — Option A: code + config now, secret at deploy)
Added an OPTIONAL dedicated marketplace-settlement source account, with a shared-account fallback:
- `relayer.config.ts` gained `marketplaceSettlementSecret` (`RELAYER_MARKETPLACE_SETTLEMENT_SECRET`, optional).
- `SorobanRelayerService` derives `settlementSource` (the dedicated keypair if set, else `this.relayer`) and a
  `settlementLockKey`: **dedicated** → `relayer:marketplace-settlement:account:<pubkey>` (its OWN sequence, so
  settlement no longer contends with bids/transfers/deploys); **fallback** (secret unset) →
  `relayer:account:<sharedPubkey>` — the SAME shared lock as bids, so an unset secret preserves today's exact
  behavior with no txBadSeq race.
- `submitSignedAcceptQuote` now sources (`getAccount`), locks (`settlementLockKey`), and signs
  (`prepared.sign(settlementSource)`) on the settlement account. The buyer/seller passkey entries don't cover
  the tx source/sequence, so switching the source can't invalidate the authorization; the account only pays
  fees + provides the source, so it needs no allowlist/KYC.
- Updated the three now-stale "shared account is a follow-up" comments (relayer impl + port interface +
  settlement config).

Verified: build 0, lint clean. The submit path is testnet-gated (e2e uses `FakeRelayerService`, which does not
touch `settlementSource`), so build+tsc is the gate; behavior with the secret unset is unchanged (shared lock).

### Deploy action (not code): provision + XLM-fund a settlement keypair and set
`RELAYER_MARKETPLACE_SETTLEMENT_SECRET` when marketplace accept volume warrants decoupling; until then leave it
unset (shared account). Joi validation of the new (optional) secret lands with [[387-pending-p2-settlement-config-bypasses-joi]].

### Files changed
- `src/config/relayer.config.ts`, `src/modules/relayer/soroban-relayer.service.ts`,
  `src/modules/relayer/relayer.service.interface.ts` (comment), `src/config/marketplace-settlement.config.ts` (comment)

## Work Log
- 2026-08-22: Filed from PR #49 review (performance C1).
- 2026-08-22: Implemented the optional dedicated account + shared fallback; build/lint green; marked complete.
