---
status: complete
priority: p2
issue_id: 321
tags: [code-review, reliability, typescript, tov-160]
dependencies: []
---
# Settle processor classifies every non-domain error as terminal — a transient DB error can wedge a settleable offering

## Problem Statement
The settle processor's terminal-vs-retryable fork is `if (err instanceof OfferingEscrowError && err.retryable) throw err; else fail() + terminal`. This makes **every** non-domain error terminal — including a transient `QueryFailedError` (deadlock / connection reset) thrown from `listBidsForClearing`, `countInflight`, or `persist()` **after** `close_and_settle` may have already landed. A half-up database can therefore spuriously stamp `settle_failed` and wedge a settleable offering out of auto-reconcile. It is recoverable (admin re-drive + `readStatus` adoption), so not fund-loss, but the money path deserves hardening. The current shape is faithful to the deploy precedent, but the settle path has post-on-chain DB writes that make transient-as-terminal materially riskier.

## Findings
- `src/modules/offerings/settle/offering-settle.processor.ts` — the classifier `if (err instanceof OfferingEscrowError && err.retryable) throw err; else fail() + terminal` treats all non-`OfferingEscrowError` (and non-retryable domain) errors as terminal.
- Transient `QueryFailedError` (deadlock / connection reset) from `listBidsForClearing`, `countInflight`, or `persist()` — falls into the `else` branch and terminalizes, even when thrown **after** `close_and_settle` landed.
- A terminalized subscribed row is excluded from `findStaleSubscribed`, forfeiting auto-reconcile (recoverable only via admin re-drive + `readStatus` adoption).
- Related: finding 320 (the outside-txn `OFFERING_CLOSED` audit is one concrete transient error that this classifier turns terminal).

## Proposed Solutions
### Option A — Default unknown/non-domain errors to retryable; enumerate terminal types
- Description: Invert the default so unknown/non-domain errors are **retryable** within the attempt budget. Reserve terminal for known-deterministic types: `RangeError` from `assertClearingInvariants`, `OfferingSettleContractError`, and `OfferingEscrowError` with `retryable: false`. Type the invariant-break throws (winner-not-escrowed, flip-mismatch) as a dedicated terminal error class so they stay terminal.
- Pros: A transient DB blip retries and self-heals instead of wedging the money path; keeps genuinely-deterministic failures terminal; the invariant breaks are made type-safe rather than relying on `instanceof RangeError`.
- Cons: A truly-permanent unknown error now consumes the retry budget before terminalizing (bounded, acceptable); requires introducing/typing a terminal invariant-break error.
- Effort: Medium
- Risk: Low

### Option B — Whitelist transient DB errors as retryable, keep terminal default
- Description: Keep the terminal default but add an explicit retryable branch for transient DB errors (e.g. `QueryFailedError` with deadlock / connection-reset codes).
- Pros: Smaller, more targeted change; leaves the deploy-precedent shape intact.
- Cons: Fragile enumeration of transient DB error codes; any unlisted transient error still terminalizes; does not address the untyped invariant-break throws.
- Effort: Small
- Risk: Medium

## Recommended Action
Option A — default unknown/non-domain errors to **retryable** within the attempt budget, and reserve terminal for known-deterministic types (`RangeError` from `assertClearingInvariants`, `OfferingSettleContractError`, `OfferingEscrowError` with `retryable: false`). Type the invariant-break throws (winner-not-escrowed, flip-mismatch) as a dedicated terminal error class so they remain terminal by type rather than by `instanceof RangeError`. This hardens the money path against transient DB failures while keeping deterministic failures terminal.

## Technical Details
The settle path, unlike deploy, performs DB reads/writes (`listBidsForClearing`, `countInflight`, `persist()`) after the on-chain `close_and_settle` may have landed, so a transient DB error thrown there must not be conflated with a deterministic settlement failure. The retry budget bounds the cost of retrying a genuinely-permanent unknown error before it terminalizes. Typing the invariant breaks as a terminal error class removes reliance on `RangeError` identity and makes the terminal set explicit and reviewable. Coordinate with finding 320 so the `OFFERING_CLOSED` audit failure is handled consistently.

## Acceptance Criteria
- A transient `QueryFailedError` (deadlock / connection reset) from `listBidsForClearing` / `countInflight` / `persist()` is retried within the attempt budget and does **not** immediately stamp `settle_failed`.
- Deterministic failures — invariant breaks (winner-not-escrowed, flip-mismatch), `OfferingSettleContractError`, and `OfferingEscrowError` with `retryable: false` — remain terminal.
- Invariant-break throws are a typed terminal error class (not identified via `instanceof RangeError`).

## Work Log
- 2026-08-20: created from PR #43 [kieran-typescript-reviewer + pattern-recognition-specialist + security-sentinel] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Inverted the settle worker's terminal-vs-retryable default. New `isTerminalSettleError(err)` classifies as
TERMINAL only deterministic failures — an `OfferingEscrowError` the adapter marked non-retryable (contract
revert/resource-exhaustion/WASM mismatch, incl. `OfferingSettleContractError`), a `RangeError` from the
clearing invariants/overflow/band belt, or a persist-time `SettleInvariantError`. Everything else (an
unknown/transient error such as a `QueryFailedError` from a repo read or `persist()` after `close_and_settle`
may have landed) now RE-THROWS as retryable → BullMQ backoff → the next attempt's self-heal `readStatus`
adopts, instead of spuriously stamping `settle_failed` and wedging a settleable offering out of the
auto-reconcile. The two persist-time invariant breaks (winner-not-escrowed, flip-mismatch) are now typed
`SettleInvariantError` so they stay terminal. Added unit U24 (transient repo error → retryable re-throw, no
`casSettleFailed`). Build green; processor spec 7/7.
