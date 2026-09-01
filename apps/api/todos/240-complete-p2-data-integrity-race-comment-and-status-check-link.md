---
status: complete
priority: p2
issue_id: 240
tags: [code-review, data-integrity, documentation, invariant, TOV-240, PR-34]
dependencies: []
---

# Document the list two-query read race; link `ARTWORK_STATUSES` tuple to the DB CHECK constraint

## Problem Statement
Two related data-integrity nits, both low-severity (code is correct today):

1. **Undocumented two-query skew on the list path.** `listArtworks` and `getArtwork` each issue two non-transactional reads (artwork row, then contract projection). The skew is bounded and self-healing — the source-of-truth flip (`casDeployed`) and the derived-latch flip (`casStatus`) are atomic in one txn (`fraction-deploy.processor.ts:114-117`), so a reader can only observe an ordinary read-snapshot gap (e.g. artwork still `fractionalizing` while the contract already reads `deployed`). This is acceptable for a read, but the rationale is documented only on `getArtwork`, not `listArtworks` — a future maintainer might "fix" it by wrapping both in a transaction (adding lock cost for zero correctness benefit).

2. **`ARTWORK_STATUSES` tuple and the DB CHECK constraint are a coupled pair with no compile/test link.** The detail endpoint echoes `artworks.status` verbatim (no runtime guard — deliberate), safe today because `CHECK (status IN ('verified','published','fractionalizing','fractionalized'))` (migration `1716000000027:49-50`) exactly matches `ARTWORK_STATUSES` (`artwork-status.constant.ts:9`). If a future migration adds a value to the CHECK without updating the tuple, the detail endpoint silently emits an out-of-`@ApiProperty({enum})` value. Same coupling for `fraction-contract.entity.ts:5` vs `CHK_fc_status`.

## Findings
Flagged by data-integrity-guardian (two P2s).
- `src/modules/backoffice/artworks/backoffice-artworks.service.ts:184-198` (list — no skew comment), `:207-216` (detail — has it).
- `src/modules/fractionalization/constants/artwork-status.constant.ts:9` vs migration `1716000000027:49-50`.
- Asymmetry note: the *contract* status has a hard `assertActiveStatus` guard; the *artwork* status (same varchar class) has none — a defensible product choice ("frontend treats unknown status as non-actionable"), but the tuple↔CHECK link is implicit.

## Proposed Solutions
1. **Add a one-line skew comment on `listArtworks`** mirroring the detail rationale. Effort: Trivial.
2. **Add an integration assertion** that `ARTWORK_STATUSES` equals the DB CHECK set (query `pg_get_constraintdef` / `information_schema`), and the same for the fraction-contract status. Catches tuple↔constraint drift in CI. Effort: Small.
3. Cheaper alternative to #2: a comment on each migration CHECK pointing to its mirror constant. Effort: Trivial. (Weaker — no test enforcement.)

## Recommended Action
**RESOLVED** (Solutions 1 + 2).
1. `listArtworks` now documents the accepted, self-healing two-query skew and explicitly says "do not wrap in a transaction."
2. Added an integration **drift guard**: two tests assert `CHK_artworks_status` == `ARTWORK_STATUSES` and `CHK_fc_status` == the fraction status union (parsed from `pg_get_constraintdef`). A migration that widens either CHECK without updating the tuple now fails CI.

## Technical Details
- Docs/test-only; no runtime behavior change.

## Acceptance Criteria
- [ ] `listArtworks` documents the accepted two-query skew.
- [ ] Either an integration test asserts tuple == DB CHECK set (preferred), or the migration CHECKs cross-reference their mirror constants.

## Work Log
- 2026-07-18: created from PR #34 review (data-integrity-guardian).
- 2026-07-18: RESOLVED — list skew comment + tuple↔CHECK integration drift guard (2 tests). Build + lint clean; integration 5/5 green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
- `src/modules/fractionalization/deploy/fraction-deploy.processor.ts:114-117` (atomic latch)
