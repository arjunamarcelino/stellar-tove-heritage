---
status: complete
priority: p2
issue_id: 218
tags: [code-review, architecture, maintainability, TOV-233, PR-32]
dependencies: []
---

# Submit/poll/lock plumbing copy-pasted from the relayer instead of the planned shared extraction; the copy has a latent unhandled-rejection

## Problem Statement
The plan called for extracting shared submit/lock plumbing into an injectable helper both services use; instead the fraction factory near-verbatim clones the relayer's most fragile paths (sequence-collision, timeout-vs-race, poll-deadline) into a second copy that will drift. The clone also drops a `.catch()` present in the original, introducing a latent unhandled-rejection on timeout.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` ~lines 223-256 (`pollForResult`, `isSequenceError`, `withTimeout`) + constants ~lines 34-36 + the `sendTransaction` status switch ~lines 159-168 near-verbatim clone `src/modules/relayer/soroban-relayer.service.ts`.
- The two most fragile, hardest-to-test paths (sequence-collision, timeout-vs-race, poll-deadline) now exist in two copies that will drift.
- Concretely: the relayer's `withTimeout` swallows the losing promise's late rejection, but the fraction copy (~lines 246-256) does NOT `.catch()` the work promise → on timeout-wins it can emit an `unhandledRejection`.

## Proposed Solutions
### Option A (recommended): extract a shared SorobanSubmitHelper
- Extract a small injectable `SorobanSubmitHelper` (or shared free functions) exposing `withTimeout`, `pollUntilSuccess(hash, deadline)`, `isSequenceError` — provided by `RelayerModule`, consumed by both services (also fixes the unhandled-rejection for free).
- If full extraction is deferred, at minimum unify `withTimeout` + `isSequenceError` and add the `.catch(() => {})` to the fraction copy.
- **Effort:** Medium.

## Recommended Action
**RESOLVED (Option A — minimal-safe, per maintainer decision).** Fixed the real bug: `withTimeout` now attaches `promise.catch(() => undefined)` so the race-losing RPC promise can't surface as an `unhandledRejection` after a timeout, and switched `timer` to `NodeJS.Timeout | undefined` with a guarded `clearTimeout`. The battle-tested `soroban-relayer.service.ts` was intentionally left untouched (regression risk); full extraction of a shared `SorobanSubmitHelper` is deferred to a follow-up — the two most fragile behaviours (`isSequenceError` typing per todo 222, and this unhandled-rejection) are now corrected in the fraction copy.

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (~lines 34-36, 159-168, 223-256); `src/modules/relayer/soroban-relayer.service.ts` (canonical copy).
- The unhandled-rejection is specifically the missing `.catch()` on the work promise when the timeout wins the race.

## Acceptance Criteria
- [ ] `withTimeout`, poll, and `isSequenceError` exist in a single shared location consumed by both services, OR the two copies are unified.
- [ ] The fraction copy no longer emits an unhandled rejection on timeout (work promise `.catch()`ed).
- [ ] Shared helper is provided by `RelayerModule` and injected, not re-instantiated.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED (minimal-safe) — withTimeout no longer leaks a rejection; relayer left intact; full extraction deferred.
