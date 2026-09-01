---
status: complete
priority: p3
issue_id: 093
tags: [code-review, quality, architecture, tov-20]
dependencies: []
---

# Minor Notes: AuthChallengeRepository Comment, `kind` YAGNI, Cap TOCTOU, Optional SDK Gateway

## Problem Statement
A cluster of low-severity notes from the PR #20 review, grouped to avoid todo sprawl. None block anything;
each is a conscious-decision or tidy-up item.

## Findings & Proposed Actions

1. **AuthChallengeRepository deviates from `BaseRepository` (intentional).**
   `src/modules/auth/repositories/auth-challenge.repository.ts:11-15` uses `@InjectRepository` directly
   (ephemeral entity, no soft-delete, all-specialized methods). It *does* keep the interface + DI token.
   → Add a one-line class comment stating why it bypasses `BaseRepository`, so a future reviewer doesn't flag it.

2. **`WalletKind` union + `kind` column + `CHECK (kind IN ('byow'))` encode a single value (YAGNI).**
   `src/modules/wallets/entities/wallet.entity.ts:6,21-22`, migration `:23,30`. Defensible forward-looking
   call (comment already says "widen as needed"). → Make it a conscious decision: keep, or drop the column
   until a second wallet kind exists.

3. **Rate-limit cap TOCTOU (accept).** `sep10.service.ts:48-59` — `countOutstanding` then `create` aren't
   atomic, so concurrent challenge requests can marginally exceed `maxOutstandingChallenges`. Anti-abuse only,
   not a security boundary. → Add a comment noting it's intentionally non-atomic; no code change.

4. **Optional: extract a `StellarWebAuthGateway`.** `sep10.service.ts` mixes stellar-sdk crypto (keypair,
   buildChallengeTx, XDR parse/validate, verifyChallengeTxSigners) with flow orchestration. ~150 lines, not a
   god-object, but the SDK is a leaky detail. → Optional hardening: isolate the SDK behind an adapter interface
   for easier mocking/network-swap. Only if it earns its keep.

## Recommended Action
Items 1–2: add comments / record the decision. Item 3: now moot (see below). Item 4: defer.

## Implemented Solution
1. **BaseRepository deviation** — added a class doc comment to `AuthChallengeRepository` explaining why it
   uses `@InjectRepository` directly (ephemeral entity, all-specialized methods) while still honoring the
   interface + DI-token convention.
2. **`kind` YAGNI** — user chose to KEEP it (forward-looking; custodial kinds expected). Strengthened the
   `WalletKind` comment to record the deliberate decision and the "widen union + CHECK together" contract.
3. **Cap TOCTOU** — **no longer applicable.** Todo 086 removed `countOutstanding` and the hard cap entirely
   (replaced by evict-oldest `pruneOutstanding`), so the non-atomic count/insert race no longer exists.
4. **`StellarWebAuthGateway` extraction** — **deferred.** `Sep10Service` (~150 lines) is an acceptable
   orchestrator; isolating the SDK behind an adapter is optional hardening with no current driver. Left as a
   future option.

## Technical Details
- Changed: `src/modules/auth/repositories/auth-challenge.repository.ts` (class comment),
  `src/modules/wallets/entities/wallet.entity.ts` (`WalletKind` decision comment).

## Acceptance Criteria
- [x] Items 1–2 addressed (comment + recorded decision).
- [x] Item 3 resolved (obsoleted by 086) and item 4 decided (deferred).

## Work Log
- 2026-07-02: Filed from PR #20 review (architecture-strategist + code-simplicity + kieran-typescript, P3 cluster).
- 2026-07-02: Fixed — added comments (1,2); noted 3 moot via 086; deferred 4. Marked complete.
