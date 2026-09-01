---
status: complete
priority: p3
issue_id: 099
tags: [code-review, consistency, tov-21]
dependencies: []
---

# Passkey Flow: Error-Body Casing + Prune/Sweep Style Drift vs SEP-10

## Problem Statement
Several cosmetic/structural drifts from the SEP-10 pattern the passkey flow claims to mirror. None
affect correctness (clients key off `errorCode`), but they create cross-surface inconsistency.

## Findings
1. **Error `error` field casing.** `PasskeyService.fail()` sets `error: HttpStatus[status]` → all-caps
   enum keys (`'UNAUTHORIZED'`, `'CONFLICT'`, `'SERVICE_UNAVAILABLE'`). SEP-10 (`sep10.service.ts:153`)
   and `wallets.service.ts` use the standard Nest reason phrase (`'Unauthorized'`, `'Conflict'`). Same
   status returns different casing across two sibling endpoints. — `src/modules/auth/passkey.service.ts:188`
2. **Prune ordering + off-by-one.** `begin` creates the challenge row THEN fires
   `pruneOutstandingByEmail(email, cap-1)` fire-and-forget. SEP-10 awaits prune BEFORE create, bounding
   at exactly `cap`; the passkey order bounds at `cap-1` (the just-inserted row is among the kept
   newest) and leaves the bound unenforced if the un-awaited prune fails. — `src/modules/auth/passkey.service.ts:62-70`
3. **Three fire-and-forget error styles.** `deleteExpired().catch(() => undefined)` (silent, ×2) +
   `pruneOutstandingByEmail(...).catch(logger.warn)`. SEP-10 routes sweeps through one private
   `sweepExpiredChallenges()` that logs. — `src/modules/auth/passkey.service.ts:69-71,178`
- Flagged by pattern-recognition-specialist (LOWs).

## Proposed Solutions

### Option A: Align to SEP-10 (recommended)
- Hardcode/​map the reason phrase in `fail()`; await prune before create in `begin` (or accept the
  stricter bound and comment it); extract a single fire-and-forget sweep helper that logs.
- **Effort:** Small · **Risk:** Low

### Option B: Accept + document
- Note the intentional deviations; leave as-is. **Effort:** Small · **Risk:** Low

## Recommended Action
_(triage)_

## Technical Details
- File: `src/modules/auth/passkey.service.ts`.

## Acceptance Criteria
- [ ] Error-body `error` casing matches sibling endpoints, or the deviation is documented.
- [ ] Prune ordering / bound is consistent with SEP-10 or explicitly commented.

## Work Log
- 2026-07-02: Filed from PR #21 pattern-consistency review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-02: PARTIAL — finding #1 (error-body casing) RESOLVED: `fail()` now emits the standard reason phrase (Unauthorized/Conflict/Service Unavailable) matching SEP-10/wallets. Findings #2 (prune ordering) + #3 (sweep error style) remain deferred (behavioral/refactor, lower value).
- 2026-07-03: RESOLVED (remaining items). Finding #2: `begin` now awaits `pruneOutstandingByEmail` BEFORE `create`, bounding at exactly maxOutstandingChallenges (matches SEP-10). Finding #3: extracted a single `sweepExpiredChallenges()` helper (logs on failure) used by both begin + finish, replacing the three ad-hoc fire-and-forget styles. (#1 error-body casing was resolved earlier.) Build+lint+tests green.
