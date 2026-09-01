---
status: complete
priority: p3
issue_id: 152
tags: [code-review, performance, quality, idempotency, TOV-24]
dependencies: []
---

# `IdempotencyStore` polish: 1-RTT `begin`, non-fatal `complete`, named constants

## Problem Statement
Several small robustness/perf/readability improvements to the idempotency store, none blocking:

1. **`begin` costs 2 Redis RTTs on the contended path** (`SET NX` fails → `GET`), which is exactly the
   replay/in-flight path a retrying client hammers; the `!raw` expiry race loops up to 3× (6 RTTs worst).
2. **`complete` isn't wrapped in try/catch** (unlike `fail`). If Redis is unreachable at `complete`, the
   wallet has already committed but the exception propagates → the client sees a 500 for a *successful* bind,
   and a same-key retry re-verifies a now-consumed challenge → `AUTH_CHALLENGE_ALREADY_USED`.
3. **Magic loop bounds / single-letter fields.** `attempt < 3` (begin) and the `StoredRecord` keys
   `s`/`f`/`t`/`b` are load-bearing (the Lua indexes them) but under-documented; TTLs are named constants for
   contrast.

## Findings
- `src/common/idempotency/idempotency-store.ts` — `begin` (SET NX → GET, 3-attempt loop), `complete` (no
  try/catch), `StoredRecord` single-letter keys, `attempt < 3` literal.
- performance (P2/P3), security (P3 complete-failure consistency), kieran (P3 naming).

## Proposed Solutions

### Option A: Fold `begin` into one Lua `EVAL`; make `complete` non-fatal; name the constants (recommended)
- Single `EVAL` that does SET-NX-or-return-existing (matches the `COMPLETE`/`FAIL` Lua pattern) → 1 RTT on the
  contended path, removes the retry loop.
- Wrap `complete`'s `eval` in try/catch (log + still return 201, since the source-of-truth write committed).
- Promote `MAX_CLAIM_ATTEMPTS` to a named constant; add a doc block mapping the `s/f/t/b` keys to their
  meaning (they must stay short for the Lua/wire, so keep the keys but document the coupling).
- **Pros:** ~50% fewer Redis RTTs on the hot path; no false 500 on a committed bind; clearer coupling.
- **Cons:** More Lua.
- **Effort:** Small–Medium · **Risk:** Low

### Option B: Do only the `complete` non-fatal fix (highest value, smallest change)
- **Pros:** Removes the user-visible false-500.
- **Cons:** Leaves the RTT + naming nits.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (all three).

## Implemented Solution
`src/common/idempotency/idempotency-store.ts`:
- **Single-EVAL `begin`.** New `BEGIN` Lua does `SET NX` and, on failure, `GET`s and returns the existing
  record in one round trip (`'PROCEED'` / `'RETRY'` / raw JSON). The contended replay/in-flight path drops
  from 2 RTT → 1.
- **Non-fatal `complete`.** Wrapped the `eval` in try/catch (log + return) — a Redis failure after the
  wallet tx committed no longer surfaces as a false 500; a same-key retry re-runs and the bound wallet is
  still visible via `GET /me/wallets`.
- **Named constant** `MAX_CLAIM_ATTEMPTS = 3`; the `s/f/t/b` record keys keep their inline doc (load-bearing
  for the Lua/wire, kept short deliberately).

Real-Redis integration spec (from [[146]]) still green (proceed/replay/in_flight/mismatch/fail); me-wallets
e2e green.

## Technical Details
Affected: `src/common/idempotency/idempotency-store.ts` (`BEGIN` Lua, `begin`, `complete`, constants).

## Acceptance Criteria
- [x] A committed bind whose `complete` fails against Redis still returns 201 (logged, not thrown).
- [x] Contended `begin` classify path is 1 RTT (single EVAL).
- [x] Loop bound named (`MAX_CLAIM_ATTEMPTS`); record-key coupling documented inline.

## Work Log
- 2026-07-15: Filed from PR #26 review (performance, security, kieran).
- 2026-07-15: Fixed — single-EVAL begin, non-fatal complete, named constant. Tests green.
