---
status: complete
priority: p3
issue_id: 313
tags: [code-review, database, documentation, tov-158]
dependencies: []
---
# Migration 037 doc nits: `down()` guard body not byte-identical to 036, and the NOT VALID/VALIDATE low-lock rationale is overstated

## Problem Statement
Two documentation-accuracy issues in migration `1716000000037` (no behavioral/data risk, but they mislead future maintainers on a money table):
1. The docstring says `down()` "restores the **verbatim** 036 three-state guard body," but the restored function body drops the four inline SQL comments present in 036. Since those comments live inside `$$…$$`, they are part of `pg_proc.prosrc`, so after a dev/test revert the restored function's stored source differs from a fresh 036 install.
2. The header claims NOT VALID/VALIDATE "avoid[s] holding ACCESS EXCLUSIVE across a full-table scan while old app instances still serve bid traffic." Under `migrationsTransactionMode:'each'`, the migration's opening `ADD COLUMN` takes ACCESS EXCLUSIVE held for the whole transaction, so the VALIDATEs and the two non-CONCURRENT index rebuilds all run under it — bid traffic blocks for the migration's duration regardless. The split only guarantees validation can't fail, not reduced contention.

## Findings
- `src/database/migrations/1716000000037-AddOfferingBidCancelStates.ts:~10-14` (lock rationale) and `~23-24, ~158-187` (down() "verbatim" claim + body).
- `src/database/migrations/1716000000036-CreateOfferingBidsTable.ts:82-114` — the source-of-truth guard-fn body with its four comments (`-- immutable columns…`, `-- soft-delete is final…`, `-- forward-only status machine…`, `-- stamps are write-once…`).
- No test compares `prosrc`, so nothing breaks today; the risk is wasted time (a maintainer diffing prosrc after rollback) or a future stricter drift-guard failing post-revert.

## Proposed Solutions
### Option A — Fix the docs to match reality
- Description: (1) Either paste the 036 body character-for-character (incl. its four comments) into 037's `down()`, OR soften the docstring to "restores the 036 three-state guard *logic*." (2) Soften the lock comment to state the migration takes a brief full-table exclusive lock and should run in a low-traffic window (ties into todo 310).
- Pros: Accurate docs on a money-table migration; zero behavior change.
- Cons: None.
- Effort: Small
- Risk: Low

### Option B — Make it genuinely online (CONCURRENTLY, split transactions)
- Description: Rework the index rebuilds as `transaction:false` + `CREATE UNIQUE INDEX CONCURRENTLY` two-step swaps.
- Pros: Real reduced contention on large tables.
- Cons: Loses the atomic index-swap (uniqueness briefly enforced by both/neither during swap) — a tradeoff the current single-transaction design chose on purpose; higher risk for little gain on today's small table.
- Effort: Medium
- Risk: Medium

## Recommended Action
Option A — fix the docs to match reality (byte-verbatim down() body + accurate lock comment).

## Technical Details
Prefer Option A (doc fix). Migration 037 has only been applied to local `tove_test`, so editing the `down()` body/comments is currently safe; if it lands on a shared DB before this is addressed, keep the edit doc-only (comments inside the fn body don't affect a re-run).

## Acceptance Criteria
- The 037 `down()` guard body either byte-matches 036 or the docstring no longer claims "verbatim."
- The NOT VALID/VALIDATE comment accurately describes the lock behavior under single-transaction mode.

## Work Log
- 2026-08-20: created from PR #42 data-integrity-guardian review (P3-1, P3-2)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20)
(1) Restored the four inline SQL comments (`-- immutable columns…`, `-- soft-delete is final…`,
`-- forward-only status machine…`, `-- stamps are write-once…`) in the 037 `down()` guard-fn body so it is
byte-for-byte identical to 036's `fn_offering_bids_guard` — `pg_proc.prosrc` now matches a fresh 036 install
after a revert. (2) Softened the header lock rationale: it now states plainly that under
`migrationsTransactionMode:'each'` the opening ACCESS-EXCLUSIVE `ADD COLUMN` is held for the whole
transaction, so the VALIDATE scans + non-CONCURRENTLY index rebuilds all block bid traffic for the migration's
duration — run in a low-traffic pre-deploy window (small table today). NOT VALID/VALIDATE is now described as
"validation can never FAIL," not "avoids the lock." (3) The down() "verbatim" claim is now accurate.

Verified the full down()→up() revert cycle on tove_test (NODE_ENV=test): both execute cleanly; the reverted
fn carries the 3-state machine. Integration 16/16, build + lint clean. Migration 037 edited in place (local
tove_test only, unmerged PR).
