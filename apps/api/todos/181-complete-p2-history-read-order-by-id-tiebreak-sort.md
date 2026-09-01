---
status: complete
priority: p2
issue_id: 181
tags: [code-review, performance, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Dropped the `id DESC` secondary sort from `HandleHistoryRepository.listByUserId` — the
ORDER BY is now `created_at DESC` only, which `IDX_handle_history_user_created (user_id, created_at DESC)`
serves directly with no Sort node. Losing the tiebreak is safe: a single collector cannot produce two rows
in the same instant, and the caller dedups by canonical, so same-timestamp tie order never affects
`previousHandles`. Updated the EXPLAIN integration test to assert the actual repo query uses the index with
no Seq Scan AND no Sort. Build clean; handle-history integration (10) green.

# listByUserId ORDER BY id-tiebreak isn't index-covered — forces a Sort

## Problem Statement
`listByUserId` orders by `createdAt DESC, id DESC`, but the index is `(user_id, created_at DESC)` — `id`
is not in the index, so the planner adds a Sort whenever rows share a `created_at`. Impact is tiny
(≤50 rows via `take: 50`), but the code comment claims the ordering is "deterministic for free," which
isn't strictly true.

## Findings
- `src/modules/users/repositories/handle-history.repository.ts:26-31` — ORDER BY with `id` tiebreak.
- `src/database/migrations/1716000000024-CreateHandleHistory.ts:54-57` — 2-column index.

## Proposed Solutions
### Option A: Drop `id` from the ORDER BY
- **Pros:** dedup-by-canonical makes tie order irrelevant to output (a collector won't produce two rows in the same microsecond); keeps the 2-column index; ORDER BY becomes index-covered. **Cons:** loses a strict total order in theory. **Effort: Small.**

### Option B: Extend the index to `(user_id, created_at DESC, id DESC)`
- **Pros:** ordering is index-covered as written. **Cons:** wider index, migration change. **Effort: Small (index change → migration).**

## Recommended Action
_(triage — Option A.)_

## Technical Details
- Files: `handle-history.repository.ts` (+ the EXPLAIN test in `handle-history.integration.spec.ts`).

## Acceptance Criteria
- [x] ORDER BY matches the index (no Sort node); EXPLAIN test updated to assert index + no Seq Scan + no Sort.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (performance-oracle).
- 2026-07-15: Resolved (Option A) — dropped `id` tiebreak; index-covered order; EXPLAIN test tightened.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
