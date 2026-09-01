---
status: complete
priority: p2
issue_id: 325
tags: [code-review, performance, scalability, tov-160]
dependencies: []
---
# Settlement serializes GLOBALLY across all offerings on one shared escrow-admin account — batch-close latency is unbounded

## Problem Statement
`OfferingSettleProcessor` runs `concurrency: 1` because every leg serializes on the ONE shared escrow admin account (the `relayer:offering-escrow:account` lock, shared with escrow deploys). This serializes settlement GLOBALLY across ALL offerings — not per-offering. Each settle job does TWO on-chain txs (`close_offering` + `close_and_settle`), each with RPC polling, so ≈ 0.5–2 min of wall-clock per job. When many offering windows close together — e.g. 20 offerings all end in the same UTC hour, or an admin batch re-drives a set of failed settlements — the queue drains strictly serially: the 20th offering settles ~20–40 min after the 1st; at 100 offerings it is hours. `attempts: 8` with exponential backoff on transient RPC failures stretches this further, and a job stuck retrying blocks the queue head. The real on-chain constraint is 1-tx-per-SOURCE-ACCOUNT-per-ledger, NOT a truly global one — settlement is forced global ONLY because a single shared admin account is the tx source for every offering.

## Findings
- `src/modules/offerings/settle/offering-settle.processor.ts:65-70` — `@Processor(OFFERING_SETTLE_QUEUE, { concurrency: 1, lockDuration: 180_000, … })`; the docstring (lines 50-54) states "`concurrency: 1` (every leg serializes on the shared escrow admin account)".
- `src/modules/offerings/settle/offering-settle.processor.ts:108-156` — two on-chain calls per job: `escrow.closeOffering(...)` then `escrow.closeAndSettle(...)`, each polled to closure inside the shared lock.
- The shared lock key `relayer:offering-escrow:account` is the SAME key used by the escrow DEPLOY worker (per module CLAUDE.md), so settlement also contends with in-flight deploys, not just other settlements.
- `attempts: 8` exp-backoff on the settle job (per the settle service enqueue) means a transiently-failing job re-occupies the single lane across its whole backoff schedule while the rest of the batch waits behind it.

## Proposed Solutions
### Option A — Shard settlement across N escrow-admin source accounts
- Description: Introduce a pool of N escrow-admin source accounts and partition the settle queue by account (e.g. `accountIndex = hash(offeringId) % N`), one lock key + one worker lane per account. The on-chain 1-tx-per-source-account-per-ledger rule is then satisfied per-account while N offerings settle in parallel — N-way throughput.
- Pros: Directly removes the global serialization (the constraint is per-source-account, not global); scales batch-close throughput linearly in N; isolates a stuck/retrying job to one lane instead of blocking the whole batch head.
- Cons: N funded admin accounts to provision/monitor/rotate; the escrow contract's `admin`/authorization model must accept any account in the pool as the settle caller (contract-side check — may not be possible if `admin` is a single fixed key); more moving parts in key management and reconcile.
- Effort: Large
- Risk: Medium

### Option B — Keep single-account serialization; document the settlements/minute SLO and accept batch-close latency (MVP)
- Description: Leave `concurrency: 1` as-is, but explicitly compute and document the throughput (≈ 0.5–2 min/settle → the queue's settlements/minute), state the worst-case batch-close latency for realistic campaign sizes, and add a monitoring alert on settle-queue depth / oldest-waiting age so a large batch is visible to on-call rather than silently slow.
- Pros: Zero contract/key changes; honest about the MVP limit; queue-depth alerting turns an invisible backlog into an actionable signal; can be revisited when campaign scale demands A.
- Cons: Does not fix the latency — a 100-offering simultaneous close still takes hours; the artist/collector settlement experience for late-in-batch offerings stays poor.
- Effort: Small
- Risk: Low

## Recommended Action
For the MVP, Option B — measure and document the settlements/minute SLO and worst-case batch-close latency, and add settle-queue-depth / oldest-job-age monitoring so a large simultaneous close is visible. Track Option A (shard across N escrow-admin source accounts, partition the queue by account) as the scale-out path once the contract's admin/authorization model is confirmed to permit a source-account pool and campaign volumes justify it.

## Technical Details
The constraint is Soroban's one-tx-per-source-account-per-ledger (see `docs/solutions/integration-issues/soroban-one-tx-per-source-account-per-ledger.md`), NOT a global settlement lock — so parallelism is available exactly to the degree the tx SOURCE is sharded. Option A's feasibility hinges on whether `OfferingEscrow.close_offering` / `close_and_settle` require a single fixed `admin` to be the tx source (like the KYC-allowlist admin-as-source pattern) or accept an authorized-but-varying source. If a fixed admin is mandatory, sharding requires `authorizeEntry` with the admin signing while a pooled relayer is the source (the fraction-factory pattern), which is a larger change. For B, the per-job wall-clock is dominated by two rounds of RPC send+poll; the SLO should be derived from measured mainnet/testnet poll-to-closure latency, not assumed.

## Acceptance Criteria
- (Option B) A documented settlements/minute SLO + worst-case batch-close latency for representative campaign sizes (e.g. 20 / 100 simultaneous closes), and a monitoring alert on settle-queue depth or oldest-waiting job age.
- (Option A, if taken) Settlement is partitioned across N source-account lanes with per-account locks; N independent offerings settle concurrently in an integration/load test; a stuck job in one lane does not block the others.
- The chosen approach and its trade-off are recorded so the global-serialization behavior is an explicit decision, not an implicit one.

## Work Log
- 2026-08-20: created from PR #43 [performance-oracle] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Per the chosen approach (document SLO + sharding seam; do NOT provision N accounts now): documented the
global-serialization SLO (~0.5–2 settlements/min, batch-close latency) and the sharding extension path
(partition the settle queue across N distinct escrow-admin SOURCE accounts, each its own lock key — the only
real lever, since raising concurrency alone causes txBadSeq) in BOTH the settle processor's class docstring
(code-visible seam at the `concurrency:1` declaration) and the deploy runbook §6. No new accounts/secrets
were added this release. Build unaffected (comment-only).
