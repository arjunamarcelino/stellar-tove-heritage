---
status: complete
priority: p2
issue_id: 114
tags: [code-review, performance, relayer]
dependencies: []
---

# buildTransfer serializes independent RPCs (simulate ∥ getLatestLedger)

## Problem Statement
`buildTransfer` in `src/modules/relayer/soroban-relayer.service.ts` runs `getAccount` →
`simulateTransaction` → `getLatestLedger` strictly sequentially (~lines 189, 205, 220).
`getLatestLedger` has NO data dependency on the simulation — it only feeds `expiresAtLedger` — so it can
overlap with the simulate. The plan explicitly required a `Promise.all`. As written, build adds ~1 RTT
(~100-300ms) to every request on the money-critical path.

## Findings
- `getAccount` (~line 189) MUST come first — the `TransactionBuilder` needs the account's sequence.
- `simulateTransaction(tx)` (~line 205) and `getLatestLedger()` (~line 220) are independent: the ledger
  sequence only feeds `expiresAtLedger = latest.sequence + SIG_VALIDITY_LEDGERS` (~line 221).
- Running them serially costs one avoidable round-trip on the money-critical `/build`.

## Proposed Solutions

### Option A: Promise.all the simulate + getLatestLedger
- After building `tx`, run `simulateTransaction(tx)` and `getLatestLedger()` concurrently via
  `Promise.all`, keeping `getAccount` first. Wrap each in `withTimeout` as today.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved via Option A.** `buildTransfer` now runs `simulateTransaction(tx)` and `getLatestLedger()`
concurrently via `Promise.all` (each still `withTimeout`-wrapped), with `getAccount` still first — one
RTT saved on the build path.

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts` — `buildTransfer` (~lines 188-221).
- Each RPC stays wrapped in `withTimeout(...)`; ordering constraint: `getAccount` before the pair.

## Acceptance Criteria
- [x] Build issues `simulateTransaction` ∥ `getLatestLedger` (concurrent), `getAccount` first.
- [x] ~1 RTT saved per build.
- [x] Tests green.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: `Promise.all([simulateTransaction, getLatestLedger])` in `buildTransfer`. Build green.
