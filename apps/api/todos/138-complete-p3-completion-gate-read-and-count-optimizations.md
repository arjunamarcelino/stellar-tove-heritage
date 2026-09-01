---
status: complete
priority: p3
issue_id: 138
tags: [code-review, performance, export, TOV-40]
dependencies: []
---

# Completion-gate: avoid repeat balance re-read after latch + collapse two COUNTs into one

## Problem Statement
Two low-frequency optimizations in the submit completion path:
1. The live-balance-zero re-read (`readHoldings`) runs on every all-confirmed submit — including repeat submits after the wallet is already latched — re-paying an `N+1` RPC each time. It should short-circuit once `exp.status === 'completed'` / the latch is done.
2. `finalizeIfAllConfirmed` runs two `COUNT` queries (total, then non-confirmed) inside the row-locked transaction, extending the `pessimistic_write` hold on the wallet row. A single conditional aggregate suffices.

## Findings
- `src/modules/wallets/export/wallet-export.service.ts:253-259` — second full holdings read per all-confirmed submit.
- `src/modules/wallets/export/repositories/wallet-export.repository.ts:92-94` — two `items.count(...)` calls in the locked tx.

## Proposed Solutions

### Option A: Short-circuit the re-read when already latched + single COUNT FILTER
- **Description:** Skip the live re-read (and the finalize) if the export is already `completed`. Replace the two COUNTs with `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status <> 'confirmed') AS remaining` via one `getRawOne()` — shorter lock hold.
- **Pros:** Fewer RPC on repeat submits; shorter critical section.
- **Cons:** Minor; low-frequency path.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Collapse the two COUNTs into one aggregate. (The repeat-read short-circuit is already covered — see below.)

## Implemented Solution
`finalizeIfAllConfirmed` now runs a single conditional aggregate
(`COUNT(*)` + `COUNT(*) FILTER (WHERE status <> 'confirmed')`) via one `getRawOne()` instead of two
`count()` round-trips, shortening the hold on the wallet-row `FOR UPDATE` lock.

The "repeat holdings re-read after latch" concern turned out to be already covered: once the wallet is
latched, a subsequent submit hits the `ALREADY_EXPORTED` (409) guard at the top of `submit()` (wallet
`status='exported'`) and never reaches the completion gate — so the live re-read only runs on the single
latching submit, as intended.

## Technical Details
Affected: `wallet-export.repository.ts` (`finalizeIfAllConfirmed`).

## Acceptance Criteria
- [x] A repeat submit after latch does not re-run the holdings read (covered by the ALREADY_EXPORTED guard).
- [x] The finalize uses one aggregate query.

## Work Log
- 2026-07-14: Filed from PR #25 review (performance reviewer).
- 2026-07-15: Single COUNT FILTER aggregate in finalize; confirmed the repeat-read is already guarded. build + lint + 10 e2e green. Marked complete.
