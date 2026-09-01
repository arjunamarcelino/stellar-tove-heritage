---
status: complete
priority: p2
issue_id: 085
tags: [code-review, performance, availability, tov-20]
dependencies: []
---

# Expired-Challenge Sweep: Unbounded Full-Table DELETE Gated on Successful Verify

## Problem Statement
`deleteExpired()` is invoked only in the success path of `verify` and runs an unbounded
`DELETE FROM auth_challenges WHERE expires_at < now()` (no LIMIT). Three compounding problems:
1. The abusive/abandoned pattern (hit `challenge`, never sign) never reaches a successful verify, so
   **no sweep ever fires** and `auth_challenges` — each row carrying a `transaction_xdr TEXT` blob —
   grows unbounded. The per-pubkey cap only limits *unexpired, unconsumed* rows.
2. Once a backlog exists, one unbounded DELETE = long transaction, index bloat, autovacuum pressure,
   and a latency spike on whichever verify triggers it.
3. Fire-and-forget (`void ...`) consumes pool connections outside request accounting; bursts stack
   overlapping DELETEs competing with foreground traffic (pool `max: 20`).

## Findings
- `src/modules/auth/sep10.service.ts:123` — only caller of `deleteExpired`, on success only, not awaited.
- `src/modules/auth/repositories/auth-challenge.repository.ts:46-48` — unbounded `delete({ expiresAt: LessThan(now) })`.
- Already flagged "scheduled challenge sweep — Deferred" in `src/modules/auth/CLAUDE.md`.

## Proposed Solutions

### Option A: Scheduled, batched, advisory-locked sweep
- **Description:** Move the sweep to a repeatable BullMQ job (already a dependency) or `@nestjs/schedule`
  cron. Batch with a bound and single-runner guard:
  ```sql
  DELETE FROM auth_challenges
  WHERE ctid IN (SELECT ctid FROM auth_challenges WHERE expires_at < now() LIMIT 1000);
  ```
  Loop until a batch deletes `< LIMIT`; wrap in `pg_try_advisory_lock(<key>)`. Delete the per-verify call.
- **Pros:** Bounded, predictable; runs regardless of login success; no request-path cost.
- **Cons:** Adds a scheduled job.
- **Effort:** Medium
- **Risk:** Low

### Option B: Stopgap — bound + guard the existing lazy delete
- **Description:** Keep the lazy call but add `LIMIT` and an advisory lock so it can't stack or run long;
  also trigger it opportunistically from `buildChallenge`.
- **Pros:** Smaller change.
- **Cons:** Still tied to traffic; doesn't fully fix the never-succeeds case.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option B — bounded lazy sweep + run it on the challenge path (user-confirmed). A dedicated scheduled
job stays a follow-up (paired with the partial index in todo 091).

## Implemented Solution
- `deleteExpired()` is now bounded and single-runner: a `pg_try_advisory_xact_lock` gate (so overlapping
  verifies/challenges don't stack) + `LIMIT 500` per call (so no single unbounded full-table DELETE).
  If the lock is held by another sweep, the call no-ops.
- `Sep10Service` extracts `sweepExpiredChallenges()` (fire-and-forget + catch) and calls it from **both**
  `buildChallenge` (after persisting) and `verify` (on success) — so abandoned flows that never reach a
  successful verify still reclaim expired rows.

## Technical Details
- Changed: `src/modules/auth/repositories/auth-challenge.repository.ts` (`deleteExpired`; removed unused
  `LessThan` import), `src/modules/auth/sep10.service.ts` (`sweepExpiredChallenges` helper, called on both paths).

## Acceptance Criteria
- [x] Expired `auth_challenges` are reclaimed independent of login success (also swept on `challenge`).
- [x] The delete is bounded (`LIMIT 500`) and single-runner (advisory lock) — no unbounded transaction.
- [ ] Dedicated scheduled sweep — intentionally deferred (follow-up; see todo 091 for the paired index).

## Work Log
- 2026-07-02: Filed from PR #20 review (performance-oracle P2 + security-sentinel P3, merged).
- 2026-07-02: Fixed — bounded advisory-locked sweep on both paths; e2e 7/7. Marked complete (scheduled job deferred).
