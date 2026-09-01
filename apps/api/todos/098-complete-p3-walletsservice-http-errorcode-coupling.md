---
status: complete
priority: p3
issue_id: 098
tags: [code-review, architecture, tov-21]
dependencies: []
---

# Neutral WalletsService Now Throws HTTP Exceptions Carrying ErrorCode

## Problem Statement
`WalletsService.createEmbeddedPasskeyWallet` throws `UnauthorizedException`/`ConflictException` with
object bodies embedding the app's `ErrorCode` enum, and the neutral wallets domain now imports
`@common/enums/error-code.enum`. Its sibling `findOrCreateForWallet` is deliberately HTTP-free
(resolves the 23505 race by re-reading the winner). So the same neutral service has two failure
philosophies, and the passkey path couples a neutral domain to the HTTP `ErrorCode` contract more
tightly than any existing neutral service (`files.service` throws plain HTTP exceptions, but without
`ErrorCode`).

The divergence is *semantically* justified — a BYOW re-login is idempotent (same key ⇒ same user),
whereas a passkey `credential_id`/`contract_address` collision genuinely means "already bound" ⇒ 409,
so a silent re-read would be wrong. This is about layering cleanliness, not correctness.

## Findings
- `src/modules/wallets/wallets.service.ts:1-11,101-170` — HTTP exceptions + `ErrorCode` import in a neutral domain service.
- Flagged by architecture-strategist (MEDIUM).

## Proposed Solutions

### Option A: Throw a domain error, map in PasskeyService (recommended)
- `createEmbeddedPasskeyWallet` throws a small `WalletBindConflictError`/`ChallengeConsumedError`
  with a discriminant; `PasskeyService.fail(...)` (which already centralizes HTTP shaping) maps to the
  HTTP `errorCode`. Keeps the neutral domain free of the HTTP/`ErrorCode` contract.
- **Pros:** Clean layering; HTTP concerns stay in the surface. **Cons:** A little more plumbing. **Effort:** Small/Medium · **Risk:** Low

### Option B: Document the intentional asymmetry
- Add `wallets/CLAUDE.md` noting `createEmbeddedPasskeyWallet` intentionally throws HTTP+errorCode
  while `findOrCreateForWallet` does not, and why.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Option A (domain error + map in PasskeyService) shipped** 2026-07-03.

## Technical Details
- File: `src/modules/wallets/wallets.service.ts`; new `src/modules/wallets/CLAUDE.md` (Option B).

## Acceptance Criteria
- [ ] Either the neutral service no longer imports `ErrorCode`/HTTP exceptions, or the asymmetry is documented.

## Work Log
- 2026-07-02: Filed from PR #21 architecture review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-03: RESOLVED via Option A. New `WalletBindError` (reason: challenge_consumed | passkey_already_bound | email_conflict) in `wallets/wallet-bind.error.ts`; `WalletsService.createEmbeddedPasskeyWallet` no longer imports HttpException/ErrorCode -- it throws the domain error. `PasskeyService.mapBindError()` maps it to the HTTP status + errorCode (centralized with the existing `fail()` shaping). 3 new unit tests cover the mapping. Build+lint clean; unit 243, integration 30, e2e 60 green.
