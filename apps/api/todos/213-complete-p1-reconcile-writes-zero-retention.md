---
status: complete
priority: p1
issue_id: 213
tags: [code-review, data-integrity, TOV-233, PR-32]
dependencies: []
---

# Reconcile path latches retention amounts as '0', permanently disagreeing with the on-chain minted amounts

## Problem Statement
The reconcile path latches `artistRetentionAmount`/`treasuryRetentionAmount` as `'0'` when the columns
are NULL — which is exactly the crash-window case it fires in. The token was deployed on-chain with the
real non-zero amounts, so writing 0 produces a permanent chain-vs-DB divergence in the off-chain record
used for later mint/settlement. The `CHK_fc_retention_amounts` constraint allows 0, so it commits
silently.

## Findings
- `src/modules/fractionalization/deploy/fraction-reconcile.processor.ts` ~lines 51-52 pass `artistRetentionAmount: row.artistRetentionAmount ?? '0'` and treasury likewise into `casDeployed`.
- The reconcile path fires exactly in the crash window (deploy succeeded on-chain, DB latch never ran), so those columns are still NULL → it writes 0 into a `deployed` row.
- But the token was deployed with the REAL non-zero amounts `floor(totalSupply×pct/100)`. These columns are the off-chain record for the later mint/settlement → permanent chain-vs-DB divergence.
- `CHK_fc_retention_amounts` allows 0 so it commits silently.
- The inputs (`row.totalSupply`, `row.artistRetentionPct`, `row.treasuryRetentionPct`) are on the row and `computeRetentionAmount` is already imported in the deploy processor.

## Proposed Solutions
### Option A (recommended): recompute retention on the reconcile path
- Recompute via `computeRetentionAmount` on the reconcile path (reproduces exactly what the worker would latch). `deploy_ledger` staying null is correct/unavoidable on reconcile, but the amounts are not.

**Effort: Small.**

### Option B: widen amounts to nullable
- Widen `DeployedLatch` amounts to `string|null` and leave null ("unknown on reconcile") rather than asserting 0.

## Recommended Action
**RESOLVED (Option A).** The reconcile promote path now recomputes `artistRetentionAmount`/`treasuryRetentionAmount` via `computeRetentionAmount(row.totalSupply, row.*RetentionPct)` — the exact `floor(totalSupply × pct/100)` values the worker would have latched — instead of the `?? '0'` fallback. On the crash-window path these columns are NULL but the token was minted on-chain with the real amounts, so writing 0 would have permanently diverged the authoritative DB record from the chain (and `CHK_fc_retention_amounts` allows 0, so it committed silently). `deploy_ledger` stays null (genuinely unrecoverable on reconcile).

## Technical Details
- Affected: `src/modules/fractionalization/deploy/fraction-reconcile.processor.ts` (~lines 51-52).

## Acceptance Criteria
- [ ] Reconcile no longer writes `'0'` retention amounts into a `deployed` row when the real amounts are non-zero.
- [ ] Retention amounts written on reconcile equal `computeRetentionAmount(...)` (or are explicitly null), matching what the worker would latch.
- [ ] No silent chain-vs-DB divergence in the retention columns after a crash-window reconcile.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — reconcile recomputes retention amounts; build green.
