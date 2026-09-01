---
status: complete
priority: p3
issue_id: 092
tags: [code-review, quality, tov-20]
dependencies: []
---

# `parseChallenge` Maps a Server-Side Build Failure to a 401 (Should Be 500)

## Problem Statement
`buildChallenge` reuses `parseChallenge` to compute the tx hash, but `parseChallenge`'s catch throws
`AUTH_SIGNATURE_INVALID` (401). On the build path the XDR came from our own `WebAuth.buildChallengeTx`, so
a parse failure there means server misconfiguration, not a bad client signature — it should surface as 500,
not a misleading auth-failure. Practically unreachable, but the error classification is wrong for that path.

## Findings
- `src/modules/auth/sep10.service.ts:70` — `buildChallenge` calls `parseChallenge(challengeTxXdr)`.
- `src/modules/auth/sep10.service.ts:133-143` — `parseChallenge` catch → `authFailure(AUTH_SIGNATURE_INVALID)`.

## Proposed Solutions

### Option A: Compute the hash inline in `buildChallenge`
- **Description:** Parse the trusted, server-built XDR directly (no `authFailure` mapping); let an unexpected
  failure become a 500. Keep `parseChallenge` for the untrusted verify path only.
- **Pros:** Correct error classification; separates trusted vs untrusted parsing.
- **Cons:** Small duplication of the parse call.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — hash the trusted server-built XDR inline; keep `parseChallenge` for the untrusted verify path.

## Implemented Solution
`buildChallenge` now computes the tx hash with a direct
`TransactionBuilder.fromXDR(challengeTxXdr, networkPassphrase).hash()` on our own server-built XDR
(trusted), instead of routing through `parseChallenge` (whose catch throws 401 `AUTH_SIGNATURE_INVALID`).
A failure there is server misconfiguration and now propagates as a 5xx via the global filter. `parseChallenge`
remains the untrusted parser used only by `verify`.

## Technical Details
- Changed: `src/modules/auth/sep10.service.ts` (`buildChallenge`).

## Acceptance Criteria
- [x] A failure building/parsing the server's own challenge surfaces as 5xx, not a 401 (verify's untrusted path still returns 401).

## Work Log
- 2026-07-02: Filed from PR #20 review (kieran-typescript-reviewer, P3).
- 2026-07-02: Fixed — inline trusted hash in buildChallenge; unit 8/8, e2e 7/7. Marked complete.
