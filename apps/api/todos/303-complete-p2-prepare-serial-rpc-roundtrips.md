---
status: complete
priority: p2
issue_id: 303
tags: [code-review, performance]
dependencies: []
---
# prepare runs the balance-read and buildBid serially + double getAccount — ~2 avoidable RPC round-trips on the interactive path

## Problem Statement
`prepare` awaits `readWalletHoldings` (getAccount + simulate) fully, THEN calls `buildBid` (getAccount + `Promise.all(simulate, getLatestLedger)`) — roughly 5 serial-ish RPCs, two of them redundant back-to-back `getAccount` calls to the same relayer account. The balance read is independent of the buildBid simulate, yet it currently gates it. `prepare` is the latency-visible call that drives the passkey prompt, so avoidable round-trips are directly user-perceptible.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:79-95` — `assertSufficientBalance` (the balance read) is awaited before `buildBid`, serializing two independent read simulations.
- `src/modules/relayer/soroban-relayer.service.ts:~294` — `readWalletHoldings` issues a `getAccount`.
- `src/modules/relayer/soroban-relayer.service.ts:~478` — `buildBid` issues a second `getAccount` to the same relayer account, back-to-back with the first.

## Proposed Solutions
### Option A — Overlap the two reads and/or share getAccount
- Description: Run the balance pre-check and `buildBid` concurrently (both are read-only and independent) and/or share a single `getAccount` fetch between them, removing ~2 serial RPCs.
- Pros: Cuts ~2 serial round-trips (~0.5-1.5s typical, up to ~10s worst case) on the passkey-gated hot path; behavior unchanged.
- Cons: Slightly more complex control flow; must ensure both reads still surface their respective errors correctly when run concurrently.
- Effort: Medium
- Risk: Low

### Option B — Leave as-is
- Description: Keep the current ordering; the "buildBid last, after cheap DB gates" ordering is already correct.
- Pros: No change; no regression risk.
- Cons: Leaves ~2 avoidable serial RPCs on the latency-visible prepare path.
- Effort: None
- Risk: None

## Recommended Action

## Technical Details
- The DB-gate ordering (cheap gates before the expensive buildBid simulation) is already correct — this item is purely about overlapping the two independent read simulations (balance read vs buildBid simulate) and/or de-duplicating the two `getAccount` calls to the same account.
- Both operations are read-only against the relayer account, so concurrency does not introduce write-ordering concerns.

## Acceptance Criteria
- `prepare` issues the two independent read simulations concurrently (or shares a single `getAccount`).
- Measured RPC round-trips on the prepare hot path are reduced.
- Behavior (validation, error surfacing, built transaction) is unchanged; `yarn test` stays green.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

`prepare()` now runs the USDC balance pre-check (`assertSufficientBalance`) and `buildBid` **concurrently**
via `Promise.all` — both are independent read-only Soroban calls, so this removes a serial round-trip from
the interactive (passkey-prompt) path. A rare wasted `buildBid` simulate on an insufficient-balance reject
is acceptable (read-only, no funds moved). The cheap DB gates in `assertBiddable` still run first (fail-fast
before any RPC), preserving the correct ordering.

Deeper redundancy (the two back-to-back `getAccount` calls inside the relayer) is left to a relayer-internal
optimization if profiling shows it matters. Service unit tests (20/20) confirm the balance/buildBid error
branches still map correctly under `Promise.all`; e2e 7/7; build green.
