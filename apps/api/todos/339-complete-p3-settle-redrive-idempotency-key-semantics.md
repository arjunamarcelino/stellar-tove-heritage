---
status: complete
priority: p3
issue_id: 339
tags: [code-review, documentation, tov-160]
dependencies: []
---
# Failed-settle re-drive reusing the same Idempotency-Key silently no-ops (document the fresh-key requirement)

## Problem Statement
For a terminally-failed `subscribed` offering, an admin re-drive (`POST :id/settle`) that reuses the **same** `Idempotency-Key` as the original settle hits `begin.outcome === 'replay'` and returns the stale `202` **without** reclaiming or enqueuing anything. The admin believes they re-drove settlement, but nothing happened. This is standard idempotency behavior (a fresh key is required to re-drive), but given the money stakes and the admin-recovery scenario, the requirement should be explicit so an operator doesn't mistake a replayed 202 for a fresh re-drive.

## Findings
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — the `settle()` idempotency `begin`: on `outcome === 'replay'` it returns the recorded `202` and short-circuits before the reclaim/enqueue, so reusing the original key after a terminal failure is a silent no-op.
- Scenario: original settle fails terminally → offering stuck `subscribed` → admin retries `POST :id/settle` with the **same** `Idempotency-Key` (e.g. replayed from a saved request) → gets the old `202` → no reclaim, no enqueue, no state change.

## Proposed Solutions
### Option A — Doc-only (recommended)
- Description: Add a one-line note to the `settle()` docstring and the FE/API contract: a failed-settle **re-drive MUST use a new `Idempotency-Key`**; reusing the original key returns the original (replayed) 202 and does not re-drive.
- Pros: Zero behavior change, zero risk; sets correct operator expectations for a money-critical recovery path.
- Cons: Relies on operators reading the contract.
- Effort: Tiny
- Risk: None

### Option B — Special-case a fresh-key requirement message
- Description: When a replay is detected for an offering that is in a terminal-failed `subscribed` state, return a distinct response/message instructing the caller to supply a new `Idempotency-Key` (rather than the stale replayed 202).
- Pros: Actively prevents the "I re-drove but nothing happened" confusion at the API surface.
- Cons: Adds branching to the idempotency path (must not weaken the money-safety guarantees); more surface to test; risk of muddying standard replay semantics.
- Effort: Small
- Risk: Low-Medium

## Recommended Action
Option A — document the fresh-key requirement in the `settle()` docstring and the FE API contract. Keep standard replay semantics intact; do not special-case unless operational evidence shows admins repeatedly hit this. No behavior change.

## Technical Details
- The replay short-circuit is correct and intentional (it's what makes the endpoint idempotent). The gap is purely expectational: a replayed 202 is indistinguishable from a fresh accept to the caller.
- Any Option-B change must preserve the existing money-safety ordering (no `fail()` after commit; reclaim/enqueue only on a genuine fresh begin).

## Acceptance Criteria
- The `settle()` docstring and the FE/API contract state that re-driving a failed settle requires a new `Idempotency-Key`, and that reusing the original key replays the prior 202 without re-driving.
- No change to the idempotency replay behavior itself (unless Option B is explicitly chosen later).

## Work Log
- 2026-08-20: created from PR #43 review (security-sentinel)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Doc-only (no behavior change): added a note to `settle()`'s docstring that re-driving a terminally-failed
settlement (`subscribed` + `settle_failed_at` set) requires a FRESH Idempotency-Key — reusing the original
key hits the stored 202 (`replay`) and returns it without reclaiming/enqueuing, so nothing happens. This is
standard idempotency semantics but is surfaced explicitly because the admin-recovery scenario makes the silent
no-op easy to miss. Build green.
