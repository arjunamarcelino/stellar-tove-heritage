---
status: complete
priority: p3
issue_id: 153
tags: [code-review, quality, api, wallets, TOV-24]
dependencies: []
---

# `MeWalletDto` carries `address` **and** `publicKey`/`contractAddress` (redundant — track removal)

## Problem Statement
`MeWalletDto.address` is defined as `contractAddress ?? publicKey ?? ''`, fully derivable from the two new
explicit fields TOV-24 added. So every byow wallet serializes its G-address twice (`address` + `publicKey`)
and every embedded wallet its C-address twice. This is transitional: `address` is the already-published
TOV-40 shape the export FE consumes, so removing it now would be a breaking change out of scope for TOV-24.

## Findings
- `src/modules/wallets/export/dto/me-wallet.dto.ts` — `address`, `publicKey`, `contractAddress` (3 fields,
  2 facts). The doc comment already flags `address` as the TOV-40 shape and the others as additive.
- simplicity reviewer (P3 — "keep for now, flag for cleanup, don't add more derivable fields").

## Proposed Solutions

### Option A: Track a follow-up to retire `address` once the export FE migrates (recommended)
Keep `address` until the TOV-40/export UI consumes `publicKey`/`contractAddress`, then remove it in a
dedicated breaking-change PR (coordinate with FE). Do not add further derivable fields meanwhile.
- **Pros:** No breakage now; clear end state.
- **Cons:** Redundancy persists until the FE migrates.
- **Effort:** Small (removal later) · **Risk:** Low (breaking when done)

### Option B: Remove `address` now and update the export FE
- **Pros:** Eliminates redundancy immediately.
- **Cons:** Breaking change beyond TOV-24 scope; needs FE coordination.
- **Effort:** Medium · **Risk:** Medium

## Recommended Action
Option A (retire later, FE-coordinated).

## Implemented Solution
Decision recorded — **keep `address` for now**; removing it is a breaking change to the already-published
TOV-40 export shape and is out of scope for TOV-24. No code change. `MeWalletDto` was NOT extended with any
further derivable fields (the `#154`/`#145`/`#151` work touched the service/enum, not the DTO shape).
Follow-up (tracked here): once the export/settings FE consumes `publicKey`/`contractAddress`, drop `address`
in a dedicated breaking-change PR coordinated with the frontend.

## Technical Details
Affected: none (decision only). `src/modules/wallets/export/dto/me-wallet.dto.ts` unchanged; `address`
remains the `contractAddress ?? publicKey` convenience alias alongside the explicit fields.

## Acceptance Criteria
- [x] Decision recorded (retire-later, FE-coordinated).
- [x] No new derivable fields added to `MeWalletDto` in the meantime.

## Work Log
- 2026-07-15: Filed from PR #26 simplicity review (P3, flag-not-cut).
- 2026-07-15: Resolved as a recorded decision — keep `address` until the FE migrates; no code change.
