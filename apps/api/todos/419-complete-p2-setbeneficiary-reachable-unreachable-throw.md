---
status: complete
priority: p2
issue_id: 419
tags: [code-review, tov-31, pr-54, concurrency, correctness, simplicity]
dependencies: []
---
# `setBeneficiary` "Unreachable" throw is actually reachable under a compound race → generic 500

## Resolution (2026-08-26)
Option A. Replaced the fixed 2-attempt loop with a bounded `MAX_SET_ATTEMPTS = 5` loop that retries on
BOTH recoverable races (the 23505 retry guard changed from `attempt === 0` to `attempt < MAX_SET_ATTEMPTS - 1`),
so a stacked 23505+concurrent-delete race no longer falls through prematurely. The exhaustion backstop now
throws a clean, retryable **`ServiceUnavailableException` (503)** instead of a bare `Error` (500), and the
comment is corrected to "practically unreachable / fail-safe transient backstop." Added a unit test
`survives a STACKED race (23505 then concurrent-delete)` asserting the compound path resolves via insert
(runInTransaction called 3×). `beneficiary.service.ts:63-93`. Build 0 issues; beneficiary unit 16/16 green.

## Problem Statement
The `setBeneficiary` retry loop is bounded at 2 attempts and its post-loop `throw new Error('setBeneficiary: exhausted retries')` is commented **"Unreachable"**. That proof is wrong: the two `continue` triggers (23505-on-insert; `applyUpdate → null` on a concurrent hard-delete) can **stack** within one request, exhausting both attempts and hitting the throw — which is a plain `Error`, so `AllExceptionsFilter` returns a **generic 500** (not a clean retry/409/200). No data corruption and it fails safe (each attempt is its own txn), but the code's own reasoning is incorrect and a rare concurrency 500 is user-facing.

## Findings
1. **Reachable throw.** `src/modules/users/beneficiary/beneficiary.service.ts:58-83` (throw at `:82`). Concrete interleaving: attempt 0 `createForUser` → concurrent insert committed → `23505` → `continue`; attempt 1 finds the row → `applyUpdate` → row hard-deleted mid-update → `affected=0` → `null` → `continue` → loop exits → throw. Flagged independently by **data-integrity-guardian (P2)**, kieran-typescript (P3), pattern-recognition (P3), code-simplicity (P2 on the loop).
2. **Root cause.** The in-txn `findByUserId` takes **no row lock** (unlike the handle path's `FOR UPDATE`), so the insert-vs-update branch decision can always be invalidated by a concurrent writer.
3. **Simplicity angle (code-simplicity P2).** The concurrent-delete re-loop branch (POST racing the same user's own DELETE, both throttled at 20/60s) is exceptionally unlikely and adds the bulk of the loop's cognitive load. Worth a conscious keep-or-trim decision, not an automatic keep. The `changedFields` diff means a bare `INSERT … ON CONFLICT` can't cleanly replace the read-then-branch, but the two-mode *retry* is the heavy part.
4. **Not test-covered.** The unit spec exercises each failure branch individually (`:160`, `:176`) but not the stacked double-fail path that reaches the throw (kieran).

## Proposed Solutions
### Option A — Loop until success with a sane bound + fix the comment (Recommended)
Replace the fixed 2-attempt bound with a small bounded loop (e.g. 3–5) that retries on *either* recoverable race, and correct the comment to "practically unreachable; fail-safe backstop after N attempts." Add a unit test for the stacked-race path. Effort: Small · Risk: Low.
### Option B — Trim branch (b), keep only the 23505 retry
Drop the concurrent-delete re-loop (accept that a POST racing the user's own DELETE may 500), simplifying the loop. Effort: Small · Risk: Low (rare 500 remains for that exact race).
### Option C — Correct the comment only
Leave behavior as-is (rare, fail-safe 500) and just fix the misleading "Unreachable" comment. Effort: Trivial · Risk: the rare 500 stays.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/beneficiary/beneficiary.service.ts:58-83`.
- Related concurrency note: `findByUserId` unlocked (contrast `UserRepository.setHandle` `FOR UPDATE`).

## Acceptance Criteria
- [ ] The post-loop throw is either truly unreachable (loop-until-success) or the comment accurately describes it as a fail-safe backstop.
- [ ] A test covers the stacked-race path (or the branch is removed).

## Work Log
- 2026-08-26: Filed from PR #54 multi-agent code review (4 agents flagged; P2/P3 split).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
