---
status: complete
priority: p2
issue_id: 433
tags: [code-review, tov-33, pr-56, correctness, domain-model, lockup]
dependencies: []
---
# Confirm the write-safe lockup gate can actually fire (address-type invariant), else it is inert surface

## Resolution (2026-08-27) — Solution 1 (document + test), user-confirmed intended
The gate is correct-as-scoped: it fires ONLY when the source embedded-wallet C-address == the contract's
`artist_address` (an artist rotating away from an embedded wallet holding their retention). Collectors are never
lock-floored; when artist retention lives elsewhere the on-chain `check_lockup_floor` is the sole hard backstop
(a mis-allow fails at submit re-sim, never moving locked funds).
- **`wallet-rotation.service.ts`**: added an explicit `INTENDED SCOPE` JSDoc on `isArtistPositionLocked` stating
  the invariant + the chain-backstop delegation.
- **Tests**: the existing unit cases already encode it — "blocks a locked artist retention position"
  (artist_address == source) and "does NOT block a collector (source is not the artist)" (different address → not
  blocked even within a lockup window). No behavior change.

## Problem Statement
The write-safe lockup gate — the AC's "clean `422 ROTATION_BLOCKED_BY_LOCKUP`" — only fires when the source
embedded-wallet **C-address** equals the fraction contract's `artist_address`. If artist retention ever lives at a
different address (commonly a BYOW **G-address** settlement wallet), the gate branch is never true and 100% of
lockup enforcement silently delegates to the on-chain FractionToken backstop. Money is safe (a mis-allow fails at
submit re-simulation), but the promised clean 422 is largely absent and the gate is misleading surface.
(architecture-strategist P2, security-sentinel P3 — two reviewers.)

## Findings
- `isArtistPositionLocked` short-circuits `if (c.artistAddress !== sourceContract) return false`
  (`wallet-rotation.service.ts:475-480`). `sourceContract` is the embedded passkey wallet **contract_address**
  (a C-StrKey); `fraction_contracts.artist_address` is `varchar(56)` and accepts G or C.
- The artist's retention is minted to the artist's **primary settlement wallet at fractionalize time**. Only when
  that was the embedded passkey wallet does `artistAddress === sourceContract` hold. In the common BYOW-settlement
  case the branch is inert → the gate never gates; the AC's 422 never fires; a locked transfer instead fails at
  submit as a generic `TRANSFER_*` (worse UX, money-safe).
- Compounding: `artistLockupUntil === null → not subject` (`:477`) means legacy/backfilled rows can also
  false-ALLOW (documented in migration 052; chain-backstopped).

## Proposed Solutions
1. **Confirm + document the invariant.** If, by product rule, an artist who holds retained fractions in an embedded
   wallet is the only rotation-of-locked-position case (a collector's purchased fractions are never lock-floored),
   then the gate is correct-as-scoped — add an explicit comment + a test asserting the C-address match is the
   intended trigger, and accept the chain backstop for the G-address case. Effort: Small.
2. **Broaden the gate to the artist's settlement address**, not just the source contract: resolve the artist's
   holding address and compare on-chain lockup regardless of address form. Requires knowing which owned address is
   the artist position. Effort: Medium.
3. **Read the on-chain lockup floor directly** (a FractionToken lockup view) as the authoritative gate rather than
   the persisted anchor + address heuristic. Effort: Medium (needs a contract view — see the token source).

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] A written statement (comment + test) of exactly when the gate fires vs. when the chain backstop is the sole
      enforcement, matching the AC's intent for `ROTATION_BLOCKED_BY_LOCKUP`.

## Resources
- PR #56; reviewers: architecture-strategist, security-sentinel. Contract: `stellar-tove-heritage/.../tove-fraction-token/src/contract.rs` (`check_lockup_floor`, retention-floor on `from`).
