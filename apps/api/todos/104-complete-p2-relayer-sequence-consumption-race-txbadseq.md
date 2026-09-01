---
status: complete
priority: p2
issue_id: 104
tags: [code-review, correctness, concurrency, blockchain, relayer, TOV-21]
dependencies: []
---

# Relayer serialization is unsound across the confirmation gap — concurrent deploys can txBAD_SEQ

## Problem Statement
The `DEPLOY_LOCK` serializes `getAccount → build → simulate → sign → submit` and then releases the
lock, running the `getTransaction` poll **outside** the lock — on the premise that "the sequence is
already consumed at submit." On Stellar/Soroban that premise is false: a source account's sequence
advances only when the tx is **applied in a closed ledger**, not when `sendTransaction` returns
`PENDING`. `getAccount` reads the last-closed-ledger entry and has no mempool visibility.

Race (two *different* credentials, back-to-back within one ~5s ledger window):
1. A locks → `getAccount` seq `N` → builds seq `N+1` → submit PENDING → **lock released**.
2. B locks immediately → `getAccount` **still returns `N`** (A not yet applied) → builds seq `N+1`.
3. At apply only one seq `N+1` succeeds; the other → `txBAD_SEQ` → poll FAILED → generic error →
   `WALLET_DEPLOY_FAILED` (503).

So releasing the lock at PENDING (before confirmation) reopens the exact collision the lock exists to
close. The relayer is a single global serialization point, so this is the throughput/correctness
ceiling for *all* registrations. Pre-existing structure (predates this delta), retriable, and
testnet-bounded at current volume — but a mainnet-scale correctness blocker.

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:96-103` (lock scope), `:132` (`getAccount`),
  `:174-189` (poll outside lock). Only the InMemory lock hides this (it chains promises); the Redis
  multi-instance path is where it bites, so unit tests (InMemoryDeployLock) won't catch it.

## Proposed Solutions

### Option A: In-memory monotonic sequence per relayer account (recommended)
Fetch the on-chain sequence once, then increment locally per submit inside the lock; re-sync from
chain on a `txBAD_SEQ`. Serialized submits stop re-reading a stale on-chain sequence. Keeps the poll
outside the lock.
- **Effort:** Medium · **Risk:** Medium

### Option B: Transparent BAD_SEQ retry
On a `txBAD_SEQ` poll failure, re-fetch the account and rebuild/resubmit inside the service (bounded
retries) instead of surfacing 503. Simplest; costs an extra ledger round-trip on collision.
- **Effort:** Small · **Risk:** Low

### Option C: Relayer-account pool / async job queue
N keypairs = N parallel sequences, or move deploys to a BullMQ job. Real scale fix; larger change,
overkill for testnet.
- **Effort:** Large · **Risk:** Medium

## Recommended Action
**RESOLVED — Option B (transparent BAD_SEQ retry).** The deploy is now wrapped in a bounded loop
(`MAX_SEQ_RETRIES = 3`): on a stale-sequence collision it re-fetches the account (fresh sequence) and
resubmits instead of surfacing a 503; a persistent sequence problem still surfaces after the bound.
The stale-sequence signal is detected from the `TransactionResultCode` enum (`txBadSeq`) — a stable
XDR discriminant, read defensively (`isSequenceError`) so a shape change / base64 string is treated
as "not a sequence error", not a crash. The larger in-memory-sequence / relayer-account-pool work
(Option A/C) is deferred to a mainnet-scale ticket; the retry is the testnet-appropriate safety net.

## Resolution (2026-07-03)
- `src/modules/relayer/soroban-relayer.service.ts`:
  - `deployPasskeyWallet` deploy block → `for (let attempt = 0; ; attempt++)` loop. Catch order:
    (1) `walletExists(derived)` self-heal [103], (2) `SequenceError && attempt < MAX_SEQ_RETRIES`
    → `continue` (re-fetch + resubmit), (3) else rethrow.
  - Added `MAX_SEQ_RETRIES` + `SequenceError` sentinel + `isSequenceError(result)` helper.
  - `buildAndSubmit` send-ERROR and `pollForResult` non-SUCCESS now throw `SequenceError` when the
    result code is `txBadSeq`.
  - Docstrings updated (class serialization note + `buildAndSubmit`).
- `test/unit/modules/relayer/soroban-relayer.service.spec.ts`: added "retries on txBAD_SEQ then
  succeeds" (2 sends, second PENDING→SUCCESS) and "gives up after MAX_SEQ_RETRIES" (4 sends).
- Verified: lint clean, `yarn build` 0 issues, relayer unit spec 12/12, full unit suite 249 passed.
- **Note:** this is the pragmatic fix; a relayer-account pool / in-memory sequence for true parallel
  throughput remains open for mainnet scale (out of scope here — see 104 Option A/C).

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts`.

## Acceptance Criteria
- [x] A `txBAD_SEQ` is retried transparently (re-fetch + resubmit), not returned as `WALLET_DEPLOY_FAILED`, until it succeeds or the bound is hit (unit-tested).
- [x] A persistent sequence problem still surfaces after `MAX_SEQ_RETRIES` (unit-tested).
- [ ] True parallel throughput (relayer-account pool / in-memory sequence) — deferred to a mainnet-scale ticket (Option A/C), not required for testnet.

## Work Log
- 2026-07-03: Filed from the factory-deploy multi-agent review (performance-oracle; the central concurrency claim).
- 2026-07-03: **Resolved** via Option B (transparent BAD_SEQ retry) — see Resolution. Committed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
- Related: todos 095 (Redis deploy lock), 103, 105
