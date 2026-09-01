---
status: complete
priority: p2
issue_id: 086
tags: [code-review, security, availability, tov-20]
dependencies: []
---

# Per-Pubkey Challenge Cap Enables Targeted Login Denial-of-Service

## Problem Statement
The outstanding-challenge cap is keyed solely on `publicKey`, which for a BYOW wallet is public
information. An attacker can call `POST auth/sep10/challenge` for a *victim's* pubkey
`maxOutstandingChallenges` (default 5) times — no signature required — filling the victim's outstanding
slots. The victim's own challenge request then throws `RATE_LIMITED` and they cannot begin authentication.
The per-IP throttle (10/min) easily covers 5 requests, and the attacker only needs ~5 requests every
5 minutes to sustain the lockout. The anti-grief protection on *consume* is good, but the *creation* cap
itself is the grief vector.

## Findings
- `src/modules/auth/sep10.service.ts:48-59` — hard-rejects with `RATE_LIMITED` when `countOutstanding >= cap`.
- `src/modules/auth/repositories/auth-challenge.repository.ts:37-44` — cap keyed on `public_key` only.
- Issuing a fresh challenge is harmless (still requires the private key to verify), so a hard cap is the wrong lever.

## Proposed Solutions

### Option A: Evict oldest instead of hard-reject
- **Description:** When at cap for a pubkey, prune/evict the oldest outstanding challenge(s) so a
  legitimate holder can always obtain a fresh one. A new challenge doesn't help an attacker (verify still
  needs the key).
- **Pros:** Removes the lockout vector; keeps a bound on rows per pubkey.
- **Cons:** Slightly more logic on the challenge path.
- **Effort:** Small-Medium
- **Risk:** Low

### Option B: Add an IP-scoped limit alongside the pubkey cap
- **Description:** Keep a (higher) pubkey cap for row-growth bounding but gate abuse primarily on IP.
- **Pros:** Attacker can't cheaply target a specific victim pubkey.
- **Cons:** IP scoping interacts with proxy/`trust proxy` config (see todo 080).
- **Effort:** Small-Medium
- **Risk:** Low

## Recommended Action
Option A — evict oldest instead of hard-reject (user-confirmed).

## Implemented Solution
- Replaced `countOutstanding` + `RATE_LIMITED` throw with `pruneOutstanding(publicKey, keep)`:
  `buildChallenge` prunes the oldest outstanding challenges down to `maxOutstanding - 1` before issuing,
  so the count stays bounded at the cap AND every `challenge` request succeeds — a spammer can no longer
  fill a victim's slots to lock them out (a fresh challenge is useless without the private key).
- `pruneOutstanding` = `DELETE ... WHERE id IN (SELECT id ... ORDER BY created_at DESC OFFSET keep)`.
- Removed the now-dead `countOutstanding`, `HttpException` import, and `RATE_LIMITED` usage in the service.
- Unit test updated: the old "rejects with RATE_LIMITED at cap" case is now "evicts oldest instead of
  rejecting" (8 `buildChallenge` calls all resolve; outstanding stays == cap). Updated `auth/CLAUDE.md`.

## Technical Details
- Changed: `src/modules/auth/repositories/auth-challenge-repository.interface.ts`,
  `.../auth-challenge.repository.ts`, `src/modules/auth/sep10.service.ts`, `test/unit/sep10.service.spec.ts`,
  `src/modules/auth/CLAUDE.md`.

## Acceptance Criteria
- [x] A third party spamming `challenge` for a victim's pubkey cannot prevent the victim from authenticating (eviction, not rejection).
- [x] `auth_challenges` growth per pubkey remains bounded (pruned to the cap on every issue).

## Work Log
- 2026-07-02: Filed from PR #20 review (security-sentinel, P2).
- 2026-07-02: Fixed — evict-oldest via pruneOutstanding; unit test reworked (8/8), e2e 7/7. Marked complete.
