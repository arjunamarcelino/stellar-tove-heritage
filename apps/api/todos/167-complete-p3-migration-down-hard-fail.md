---
status: complete
priority: p3
issue_id: 167
tags: [code-review, migration, data-integrity, operational-safety, tov-25]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. `down()` of `AddWalletsIsPrimary1716000000020` now throws when
`NODE_ENV === 'production'` unless `ALLOW_DESTRUCTIVE_DOWN=1` is set, so a routine `migration:revert` can't
silently drop user-chosen primaries. The error message tells the operator to export `is_primary` and opt in.
Dev/test reverts are unaffected. Migration typechecks clean.

# Migration 1716000000020 down() is now destructive — consider hard-fail outside dev

## Problem Statement
`down()` of `AddWalletsIsPrimary1716000000020` drops the `is_primary` column. TOV-25 makes `is_primary`
user-chosen (set-primary + delete auto-promote), so it is **no longer re-derivable** from wallet order — a
revert silently discards user-chosen settlement wallets, and re-`up()` re-marks each user's oldest wallet
primary, overwriting deliberate choices. This PR correctly upgraded the comment to a loud `⚠️ DATA LOSS`
warning, but the `down()` still executes silently; a comment alone doesn't prevent an operator foot-gun.

## Findings
- `src/database/migrations/1716000000020-AddWalletsIsPrimary.ts` `down()` — drops the index + column; comment
  now warns of data loss (added in this PR).
- Reverting in an environment with real user primaries = unrecoverable loss of settlement-wallet selections.

## Proposed Solutions
### Option A: Make `down()` hard-fail outside development
- Throw unless an explicit env flag (e.g. `ALLOW_DESTRUCTIVE_DOWN=1`) or `NODE_ENV !== 'production'`, so a
  routine `migration:revert` can't silently wipe primaries.
- **Pros:** turns a silent foot-gun into an explicit, opt-in action. **Cons:** slight friction for legitimate
  dev reverts. **Effort: Small.**

### Option B: Keep the warning comment only
- **Pros:** zero change. **Cons:** relies on the operator reading the comment. **Effort: None.**

## Recommended Action
_(triage)_

## Technical Details
- File: `src/database/migrations/1716000000020-AddWalletsIsPrimary.ts` (`down()`).

## Acceptance Criteria
- [ ] Decision recorded; if Option A, `down()` guards against silent destructive revert outside dev.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (architecture + data-integrity). Comment warning was
  added in the PR; this todo is about enforcing it.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
