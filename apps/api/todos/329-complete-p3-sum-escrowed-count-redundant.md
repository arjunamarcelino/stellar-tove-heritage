---
status: complete
priority: p3
issue_id: 329
tags: [code-review, performance, simplification, tov-160]
dependencies: []
---
# `settle()` fires a redundant `sumEscrowedCount` query that `computeClearing` already returns

## Problem Statement
`BackofficeOfferingsService.settle()` issues four separate reads against `offering_bids` during its precondition gate: `countInflight`, `countActiveForOffering`, `sumEscrowedCount`, and `listBidsForClearing`. The `sumEscrowedCount` query exists solely to gate the undersubscription case (`demand < publicFloat`) — but that exact quantity is `result.totalDemand`, and the fully/under-subscribed decision is `result.fullySubscribed`, both of which `computeClearing(listBidsForClearing(...))` already returns a few lines later. The code even re-checks `!result.fullySubscribed` immediately after as a "belt", proving the `sumEscrowedCount` gate is duplicative. This is not an N+1 (constant number of queries) and the path is admin-only + low-frequency, so the absolute cost is small — it is a simplification / redundant-work finding, not a hot-path performance defect.

## Findings
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:424-435` — the four-read block: `countInflight` (424), `countActiveForOffering` (428), `sumEscrowedCount` → `demand < publicFloat` gate (432-435).
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:438-443` — `listBidsForClearing` + `computeClearing`, then the `!result.fullySubscribed` re-check (440-443) that duplicates the `sumEscrowedCount` gate's intent.
- `src/modules/offerings/clearing.ts:52-68` — `ClearingResult` already carries `totalDemand` and `fullySubscribed`, derived from the same escrowed book.

## Proposed Solutions
### Option A — Drop `sumEscrowedCount`; gate on `!result.fullySubscribed`
- Description: Move the `listBidsForClearing` + `computeClearing` call above the undersubscription gate, then reject on `!result.fullySubscribed` (which already implies `demand < publicFloat`). Delete the `sumEscrowedCount` repo method if unused elsewhere.
- Pros: Removes one query + one repo method; single source of truth for the subscription decision; the existing belt check becomes the gate.
- Cons: Reorders the gate so the (small) clearing computation runs before the undersubscription rejection instead of after — negligible on an admin path.
- Effort: Small
- Risk: Low

### Option B — Collapse to ~2 reads by deriving counts in JS from the loaded book
- Description: Derive `countActiveForOffering` and the escrowed-count from the `listBidsForClearing` rows in JS, leaving only `countInflight` as a separate query (it needs `submitted|canceling` rows, which are NOT in the escrowed clearing list). Collapses four reads to ~two.
- Pros: Fewer round-trips; the loaded book already contains the escrowed rows the counts need.
- Cons: `countActiveForOffering` semantics must be verified to match "escrowed rows in the clearing list" exactly (active-vs-escrowed distinction); `countInflight` cannot be derived and must stay.
- Effort: Small
- Risk: Low

### Option C — Leave as-is
- Description: Accept the redundant query on a low-frequency admin path.
- Pros: Zero change.
- Cons: Keeps a redundant query + repo method and two expressions of the same gate.
- Effort: None
- Risk: Low

## Recommended Action
Option A — drop `sumEscrowedCount` and gate undersubscription on `!result.fullySubscribed` derived from the already-loaded book. Consider Option B's further collapse (derive `countActiveForOffering` in JS, keep only `countInflight` separate) if the active-vs-escrowed semantics line up cleanly.

## Technical Details
Confirm `countActiveForOffering` counts the same rows `listBidsForClearing` returns before deriving it in JS — if "active" includes states not in the clearing list, Option B's derivation is unsafe and only Option A applies. `countInflight` (submitted|canceling) is genuinely a distinct query and stays.

## Acceptance Criteria
- `settle()` no longer issues `sumEscrowedCount`; the undersubscription rejection is driven by the `computeClearing` result.
- The `sumEscrowedCount` repo method is removed if it has no other caller.
- Existing settle precondition tests (undersubscribed → 422) still pass.

## Work Log
- 2026-08-20: created from PR #43 performance-oracle + code-simplicity-reviewer review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Dropped the redundant `sumEscrowedCount` demand query from the settle preconditions — `computeClearing`
already returns `fullySubscribed` (Σ escrowed count == public_float exactly), which the code checks right
after anyway. The settle service now loads the book once (`listBidsForClearing`) and gates undersubscription
on `!result.fullySubscribed`. Deleted the now-unused `sumEscrowedCount` repo method + its interface entry.
Updated settle-service unit U13e to drive undersubscription via an under-float book instead of the removed
mock. Build green; settle service spec 12/12.
