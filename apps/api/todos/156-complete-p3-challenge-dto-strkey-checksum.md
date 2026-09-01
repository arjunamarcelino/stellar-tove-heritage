---
status: complete
priority: p3
issue_id: 156
tags: [code-review, quality, validation, wallets, TOV-24]
dependencies: []
---

# `AddWalletChallengeDto.publicKey` validates shape, not the StrKey checksum

## Problem Statement
`@Matches(/^G[A-Z2-7]{55}$/)` validates the ed25519 G-address *shape* but not the StrKey CRC checksum, so a
malformed-but-well-shaped key passes DTO validation and only fails deeper (inside `buildChallenge`/the SDK).
For a money-adjacent surface, prefer validating the actual StrKey. Note: the SEP-10 `Sep10ChallengeDto` uses
the same regex, so this may be a codebase-wide convention worth aligning rather than a one-off.

## Findings
- `src/modules/wallets/export/dto/add-wallet-challenge.dto.ts` — `@Matches(/^G[A-Z2-7]{55}$/)`.
- Same regex in `src/modules/auth/dto/sep10-challenge.dto.ts` (existing convention).
- kieran-typescript reviewer (P2/P3).

## Proposed Solutions

### Option A: Custom `@IsStellarPublicKey` validator using `StrKey.isValidEd25519PublicKey` (recommended)
Reuse the pattern of the existing `@IsStellarAddress` validator but constrained to ed25519 G-addresses; apply
it here (and optionally align `Sep10ChallengeDto`).
- **Pros:** Rejects bad checksums at the edge with a clean 400; consistent with the money surfaces.
- **Cons:** A small validator; decide whether to also change the auth DTO (broader).
- **Effort:** Small · **Risk:** Low

### Option B: Leave the regex (SDK rejects invalid keys downstream)
- **Pros:** No change; matches the existing SEP-10 DTO.
- **Cons:** Weaker edge validation; error surfaces deeper.
- **Effort:** None · **Risk:** Low

## Recommended Action
Option A (custom StrKey validator).

## Implemented Solution
- New **`src/common/validators/is-stellar-public-key.validator.ts`** — `@IsStellarPublicKey()` using
  `StrKey.isValidEd25519PublicKey` (validates the CRC checksum; stricter than `@IsStellarAddress`, which
  also accepts C-addresses, and than the shape-only regex).
- `AddWalletChallengeDto.publicKey` now uses `@IsStellarPublicKey()` (replaced the `@Matches(/^G…/)` regex).
- Left the SEP-10 login `Sep10ChallengeDto` on its existing regex (out of scope; not money-add).
- Added a DTO validation unit spec: bad-checksum / C-address / garbage / empty → validation error; valid
  G-address passes.

Build/lint clean; DTO unit (5) + me-wallets e2e (9) green.

## Technical Details
Affected: new `is-stellar-public-key.validator.ts`; `add-wallet-challenge.dto.ts`; new
`add-wallet-challenge.dto.spec.ts`.

## Acceptance Criteria
- [x] Bad-checksum G-address → validation error (→ 400 at the DTO) with a test covering it.

## Work Log
- 2026-07-15: Filed from PR #26 kieran-typescript review (P3).
- 2026-07-15: Added `@IsStellarPublicKey` (StrKey checksum) on the challenge DTO + validation test.
