---
status: complete
priority: p2
issue_id: 097
tags: [code-review, security, auth, tov-21]
dependencies: []
---

# Idempotent-Replay Re-Mints Tokens Within the Challenge Window (Bypasses Refresh Revocation)

## Problem Statement
The `finish` idempotent-replay branch re-issues fresh access+refresh tokens whenever a submitted
`attestationResponse` (a) re-passes `verifyRegistrationResponse` against a still-present challenge row
and (b) resolves to an existing credential whose bound user email matches.

**Not a forgery oracle** (confirmed): an attacker cannot mint tokens for an arbitrary victim — they
must possess that victim's *original, validly-signed* `finish` request body. But within the window
(challenge TTL ~5 min after `begin`, until `deleteExpired` sweeps it), that captured body can be
replayed to mint **fresh** tokens repeatedly. This defeats WebAuthn's single-use-challenge property
and, notably, **survives refresh-token rotation/revocation** — a revoked session can be re-minted
from the old request blob. The in-code comment ("gated behind verify, so not a token oracle") is
accurate about forgery but understates this replay exposure.

Severity is bounded by the capture requirement (TLS-protected in transit) and the short window.

## Findings
- `src/modules/auth/passkey.service.ts:129-137` — replay branch returns fresh tokens.
- The replay is reachable *because* the consumed/expired classification runs AFTER the replay check
  (an intentional design so a lost-response retry succeeds). Note: simply deleting the challenge on
  success would break legitimate replay (findByChallenge → NOT_FOUND), so deletion is NOT a valid fix.
- Flagged by security-sentinel (P2).

## Proposed Solutions

### Option A: Bind the retry to a fresh proof (Idempotency-Key) (recommended if tightening)
- Issue an `Idempotency-Key` at `begin`, require it at `finish`, and key the replay on it (cache the
  first response, replay only for the same key within a short window). Removes the "replay any
  captured signed body" property while keeping safe retries.
- **Pros:** Closes the re-mint window; standard idempotency pattern. **Cons:** New surface + a small store. **Effort:** Medium · **Risk:** Low

### Option B: Accept + document the residual risk
- Keep as-is (bounded, capture-gated, ~5 min), document explicitly in `auth/CLAUDE.md`, and rely on
  the deferred scheduled sweep to shrink the window. Reasonable given the endpoint is testnet-only.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Option B (accept + document)** — chosen 2026-07-03. Bounded/capture-gated; hardening (Idempotency-Key) folded into the mainnet money-surface work.

## Technical Details
- File: `src/modules/auth/passkey.service.ts` (finish, replay branch).

## Acceptance Criteria
- [ ] Decision recorded (tighten vs accept) with rationale in `auth/CLAUDE.md`.
- [ ] If tightened: a captured `finish` body cannot re-mint tokens after the first success.

## Work Log
- 2026-07-02: Filed from PR #21 security review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-03: RESOLVED (accept + document). Expanded the replay-branch comment in `passkey.service.ts` (forgery-oracle vs re-mint distinction + residual risk) and added an explicit note to `auth/CLAUDE.md`. No behavioral change; testnet-scoped decision.
