---
status: complete
priority: p1
issue_id: 176
tags: [code-review, data-integrity, concurrency, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (row lock). Added `lock: { mode: 'pessimistic_write' }` to the in-transaction `manager.findOne`
of the caller's own `users` row in `UserRepository.setHandle` (emits `SELECT … FOR UPDATE`). Two concurrent
same-user `setHandle` calls now serialize on that row: the second re-reads the committed handle before
computing `changed`, instead of both snapshotting the stale pre-change value under READ COMMITTED. Cross-user
calls lock different rows, so there is no added contention (verified — the TOV-26 cross-user concurrency test
`serializes concurrent claims — exactly one wins, one 409` still passes). Added a **deterministic** integration
test: two concurrent `setHandle(id,'second')` after `setHandle(id,'first')` append exactly ONE `'second'` row
(count 2), where the un-locked code would append two (count 3) — so the test fails without the lock and passes
with it. handle-history integration 10 green, handle integration 13 green, build clean.

# setHandle same-user race under READ COMMITTED can corrupt the handle_history ledger

## Problem Statement
`UserRepository.setHandle` runs SELECT current handle → compute `changed` → UPDATE users → conditional
INSERT handle_history inside `runInTransaction` at the default READ COMMITTED isolation (no isolation level
set, no row lock). Two concurrent `setHandle` calls for the SAME userId both snapshot the OLD handle before
blocking on the users-row write lock, so `changed` is computed against stale data. Outcomes:
(a) two history rows appended for the same new handle — violates the no-op-suppression invariant;
(b) `a→b` then `a→a` (revert) leaves an orphan `b` history row while the current handle is `a` with no
"back to a" row — a wrong "previously known as" ledger. Same-user updates never 23505 against themselves,
so this escapes `HandleService`'s catch silently.

## Findings
- `src/modules/users/repositories/user.repository.ts:40-51` — SELECT→compute→UPDATE→INSERT, no lock.
- `src/common/repositories/base.repository.ts:83-97` — `runInTransaction` sets no isolation level.

## Proposed Solutions
### Option A: Row lock
- Lock the user row in the SELECT — `manager.findOne(User, { where: { id: userId }, select: { id: true, handle: true }, lock: { mode: 'pessimistic_write' } })` (emits `SELECT ... FOR UPDATE`), forcing the second transaction to re-read the committed handle.
- **Pros:** minimal, targeted; no retry loop. **Cons:** adds a row lock on the hot path. **Effort: Small.**

### Option B: Serializable
- Set SERIALIZABLE on the transaction and retry on serialization failure.
- **Pros:** broadest correctness guarantee. **Cons:** needs retry plumbing. **Effort:** Medium.

## Recommended Action
_(triage — Option A: row lock is the minimal complete fix.)_

## Technical Details
- Files: `src/modules/users/repositories/user.repository.ts` (+ an integration test in `test/integration/modules/users/handle-history.integration.spec.ts`).

## Acceptance Criteria
- [x] Concurrent same-user `setHandle` produces a correct ledger (no orphan/duplicate rows; no-op suppression holds under concurrency).
- [x] Integration test asserts the fix — concurrent same-user set of the same value appends exactly one row (deterministic: 2 vs the un-locked 3). Cross-user concurrency unaffected.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (data-integrity-guardian).
- 2026-07-15: Resolved (Option A) — pessimistic_write lock on the own-row SELECT + deterministic concurrency integration test. Handle-history (10) + handle (13) integration green.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
