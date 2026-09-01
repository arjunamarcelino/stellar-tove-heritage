---
status: complete
priority: p3
issue_id: 225
tags: [code-review, quality, soroban, TOV-233, PR-32]
dependencies: []
---

# SorobanFractionFactoryService polish: several small robustness/consistency items

## Problem Statement
`SorobanFractionFactoryService` is functionally sound, but a cluster of small robustness and consistency
items remain: an uncancelled timeout race, a fixed-interval poll held inside the relayer lock, a
non-transactional DB write inside the lock, a message-less error class, an inconsistent enum-identity
idiom, hardcoded constants amid config-driven values, and a derived-address fallback of questionable
value. None blocks the deploy path; several fold naturally into the todo-215 lock rework.

## Findings
- **`withTimeout` leaks the underlying RPC** — `src/modules/fractionalization/soroban-fraction-factory.service.ts:246-256`: races a timer but never cancels the underlying RPC, so on timeout the HTTP request keeps running. At the reconcile sweeper's N-per-tick this can accumulate in-flight sockets. Pass an AbortSignal to the SDK fetch if socket exhaustion appears.
- **`pollForResult` fixed interval, held inside lock** — `soroban-fraction-factory.service.ts:223-235`: polls a fixed 1s interval with no backoff, and each `getTransaction` RPC is held INSIDE the relayer lock. Resolved for free if todo 215 moves the poll outside the lock; otherwise add a short backoff.
- **`setTxHash` non-transactional UPDATE inside the lock** — `src/modules/fractionalization/fraction-contract.repository.ts:25-32` (called via `onTxHash`, `soroban-fraction-factory.service.ts:~156`): a non-transactional DB UPDATE runs inside the lock between sign and send, so a slow DB write extends the lock hold on the sequence-consumption path. Consider fire-and-forget after send.
- **`FractionSequenceError` has no message** — `soroban-fraction-factory.service.ts:~166`: thrown with no message, so the worker's `String(err)` log shows just the class name. Give it a default message like `'txBadSeq on relayer account'` for parity with `FractionThrottledError`.
- **Enum-identity idiom inconsistency** — `soroban-fraction-factory.service.ts:85-86` uses `scv.switch() === xdr.ScValType.scvVoid()` while `:183` and `:240` use `.switch().name === '...'`. Standardize on `.switch().name === 'scvVoid'` / `'scvAddress'` for readability and grep-ability.
- **Hardcoded consts amid config-driven code** — `soroban-fraction-factory.service.ts:34-38`: `RPC_TIMEOUT_MS` / `LOCK_TTL_MS` / `AUTH_VALID_LEDGERS` are hardcoded while the rest is config-driven. Derive `LOCK_TTL_MS` from `deployTimeoutMs` (ties to todo 215).
- **Off-chain `derived` of marginal value** — `soroban-fraction-factory.service.ts:~93`: `derived` is used only for a warn-on-mismatch plus a `?? derived` fallback whose own comment says the on-chain check is authoritative. Trim, or keep as documented defense-in-depth.

## Proposed Solutions
### Option A: fix the trivia now, fold the rest into the lock rework
- Address the message-less error (#4) and the enum-identity idiom (#5) now — both trivial.
- Fold the timeout cancellation (#1), poll backoff (#2), non-transactional write (#3), and hardcoded `LOCK_TTL_MS` derivation (#6) into the todo-215 lock rework.
- Decide the fate of the off-chain `derived` fallback (#7): trim or keep as documented defense-in-depth.
- **Effort: Small.**

## Recommended Action
**RESOLVED.** Disposition per item:
- (1) `withTimeout` unhandled-rejection — FIXED in todo 218 (`promise.catch(() => undefined)` + guarded `clearTimeout`). Cancelling the underlying RPC via `AbortSignal` is deferred (needs SDK fetch plumbing; negligible at current volume).
- (2) poll fixed-interval inside the lock — the poll now runs OUTSIDE the lock (todo 215), so the fixed 1s interval no longer holds the relayer account; accepted as-is.
- (3) `setTxHash` on the locked path — retained: it must persist the hash BEFORE send (for retry/reconcile), and it is a single indexed UPDATE; documented as intentional.
- (4) `FractionSequenceError` empty message — FIXED (now `'txBadSeq on the fraction relayer account'`), added in the todo 215 commit.
- (5) enum-identity vs `.name` idiom — STANDARDIZED on `.switch().name === '...'` across `tokenOf` and the poll decode (done in the 212/215 commits); no `xdr.ScValType.scvX()` identity comparisons remain.
- (6) hardcoded `LOCK_TTL_MS` — now correct for the send-only critical section (poll moved out, todo 215); no longer needs deriving from `deployTimeoutMs`.
- (7) off-chain `derived` — kept as documented defense-in-depth (the fallback token address when the on-chain return value can't be decoded).

## Technical Details
- `src/modules/fractionalization/soroban-fraction-factory.service.ts:34-38`, `:85-86`, `:93`, `:156`, `:166`, `:183`, `:223-235`, `:240`, `:246-256`
- `src/modules/fractionalization/fraction-contract.repository.ts:25-32`
- Several items depend on / are subsumed by todo 215 (lock rework).

## Acceptance Criteria
- [ ] `FractionSequenceError` carries a default message.
- [ ] Enum-identity checks use a single consistent idiom (`.switch().name === '...'`).
- [ ] Timeout cancellation, poll backoff, and the non-transactional in-lock write are addressed (here or via todo 215).
- [ ] `LOCK_TTL_MS` is derived from config, and the fate of the off-chain `derived` fallback is decided.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — items folded into the 212/215/218 commits or accepted with rationale.
