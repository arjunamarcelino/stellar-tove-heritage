---
status: complete
priority: p2
issue_id: 296
tags: [code-review, architecture, api-design]
dependencies: []
---
# Bid surface leaks TRANSFER_* error codes; mapRelayerError not compile-exhaustive

## Problem Statement
`mapRelayerError` maps `simulation_failed`/`transfer_failed`/`unavailable`/default to `ErrorCode.TRANSFER_UNAVAILABLE` — a `wallets/transfer` domain code leaking onto the public `POST /offerings/:id/bids` contract, violating the domain-prefix rule in `src/modules/CLAUDE.md`. It also collapses a client-caused `simulation_failed` (undeployed wallet / consumed nonce) into a 503 instead of a 4xx. Finally, the switch has a non-exhaustive `default` arm, so a newly added `TransferErrorReason` silently falls through to an opaque 503 with no compile-time signal.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:325-343` — switch maps `simulation_failed`/`transfer_failed`/`unavailable`/default to `ErrorCode.TRANSFER_UNAVAILABLE`; the balance path at line 307 also emits a `TRANSFER_*` code. Scenario: a collector submits a bid whose wallet is undeployed → `simulation_failed` → returned as `TRANSFER_UNAVAILABLE` 503 on a `/offerings/:id/bids` route.
- `src/common/enums/error-code.enum.ts:107-118` — the `BID_*` block has no `unavailable`/`rejected`/`simulation_failed` analogue, so there is currently no in-domain code to map to.

## Proposed Solutions

### Option A — Add BID_* analogues + compile-exhaustive switch
Description: Add `BID_UNAVAILABLE` (503), `BID_ESCROW_REJECTED` (422), and `BID_SIMULATION_FAILED` (422) to the `BID_*` group in `error-code.enum.ts`. Map `unavailable`/`transfer_failed` → `BID_UNAVAILABLE`/`BID_ESCROW_REJECTED`, and client-caused `simulation_failed` → `BID_SIMULATION_FAILED` (422). Replace the `default` arm with an exhaustive check that assigns the switch scrutinee to `never`, forcing a compile error when a new `TransferErrorReason` is introduced.
Pros: Keeps the public bid contract inside its own domain prefix; correctly distinguishes client-caused (4xx) from infra (503); future reasons fail loudly at compile time.
Cons: Adds new enum members and requires touching the HTTP status mapping.
Effort: Small.
Risk: Low.

### Option B — Reuse a neutral shared code
Description: Introduce or reuse a domain-neutral shared error code (e.g. a generic `ESCROW_UNAVAILABLE`) and map the bid surface to it instead of `TRANSFER_*`.
Pros: Removes the cross-domain leak with fewer new symbols.
Cons: Weaker — still does not separate client-caused from infra failures, and a shared code blurs which surface produced it; no compile-exhaustiveness gain unless also added.
Effort: Small.
Risk: Low-Medium.

## Recommended Action

## Technical Details
The switch scrutinee is a `TransferErrorReason` union. An exhaustive default of the form `const _exhaustive: never = reason;` guarantees any new union member is a type error until handled. The balance-path code at `offering-bids.service.ts:307` must also be migrated off `TRANSFER_*`. HTTP status: `BID_UNAVAILABLE` → 503; `BID_ESCROW_REJECTED` / `BID_SIMULATION_FAILED` → 422.

## Acceptance Criteria
- No `TRANSFER_*` error code is returned from any `/offerings/:id/bids*` route.
- Adding a new `TransferErrorReason` produces a compile error until it is explicitly mapped.
- Client-caused simulate failures (undeployed wallet / consumed nonce) return 422, not 503.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Added two domain-prefixed codes and stopped returning `TRANSFER_UNAVAILABLE` from the bid surface:
- `BID_ESCROW_REJECTED` (422) ← relayer `simulation_failed` / `transfer_failed` (a client-caused
  simulate rejection is now a 4xx, not a 503).
- `BID_UNAVAILABLE` (503) ← relayer `unavailable` + any non-`RelayerTransferError` fallback.

`mapRelayerError` (`offering-bids.service.ts`) is now **compile-exhaustive**: a `never` assertion in the
`default` makes a newly-added `TransferErrorReason` a build error instead of a silent opaque 503. Contract
doc error table updated. Build green.
