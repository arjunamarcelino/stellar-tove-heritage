---
status: complete
priority: p3
issue_id: 343
tags: [code-review, data-integrity, documentation, tov-162]
dependencies: []
---
# Defensive-input note + runbook drain-SQL/prose imprecision (PR #44)

## Problem Statement
Two low-severity items from the PR #44 review: a defense-in-depth observation about input trust in `computeClearing`, and a minor imprecision in the TOV-162 deploy-drain guard's SQL-vs-prose in the runbook. Neither is a live defect.

## Findings
Sources: data-integrity-guardian, security-sentinel (PR #44 review).

- **(data-integrity, p3, defense-in-depth) No explicit guard against a negative/zero `count` on a non-winning bid in `computeClearing`.** `src/modules/offerings/clearing.ts:100-110` trusts input `count`/`priceStroops` to be non-negative. Div-by-zero and negative allocation are structurally prevented for the clearing tier (a 0-count bid cannot cross `publicFloat`, so `totalAtClearing >= 1`) and the belt catches winners, and upstream `offering_bids` DB CHECK constraints enforce positivity — so this is defense-in-depth only, not a live gap. Optional: an explicit `count >= 0` / `priceStroops >= 0` assertion at the top of `computeClearing` would make the pure function self-defending independent of its caller.
- **(security, p3, doc) Runbook drain-guard SQL vs prose imprecision.** `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` §7 drain SQL (`SELECT ... WHERE status = 'subscribed'`, "must return 0 rows") also returns `subscribed` rows that carry a resolved `settle_failed_at` terminal — which the following prose correctly says are acceptable. The SQL and prose are individually correct but read as slightly contradictory ("0 rows" vs "settle_failed terminals are OK"). Tightening the SQL to `WHERE status='subscribed' AND settle_failed_at IS NULL` would make "0 rows" literally the go/no-go, matching the prose.

## Proposed Solutions
### Option A — Apply both (add input assertion + tighten drain SQL)
- Description: Add a top-of-function positivity assertion in `computeClearing` (throws `RangeError`, already terminal); change the runbook drain query to exclude resolved `settle_failed_at` rows so "0 rows" is the literal gate.
- Pros: Pure function self-defends; runbook SQL is copy-paste-correct as a go/no-go.
- Cons: The input assertion is redundant with DB CHECKs (belt-and-suspenders); tiny churn.
- Effort: Small
- Risk: Low

### Option B — Runbook SQL only; leave the input trust as-is
- Description: Only tighten the drain SQL; rely on DB CHECKs for input positivity (documented here).
- Pros: Minimal; addresses the one thing an operator copy-pastes.
- Cons: `computeClearing` stays caller-trusting.
- Effort: Small
- Risk: Low

## Recommended Action
Option B — tighten the runbook drain SQL (an operator will literally run it), and record the input-trust observation as accepted defense-in-depth (DB CHECKs already enforce positivity; the pure function is only ever fed the escrowed book). Revisit the input assertion only if `computeClearing` ever gains a second, less-trusted caller.

## Technical Details
- Affected: `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` (§7 drain SQL) — a `docs/solutions/` file, so it is a **protected pipeline artifact**: edit its content, never propose deleting/gitignoring it.
- `src/modules/offerings/clearing.ts:100-110` — optional input assertion (Option A only).

## Acceptance Criteria
- Runbook §7 drain SQL returns 0 rows iff there is genuinely nothing mid-settle (excludes resolved `settle_failed_at` terminals), matching the surrounding prose.
- (If Option A) `computeClearing` throws a `RangeError` on a negative `count`/`priceStroops` input, asserted by a unit test.

## Work Log
- 2026-08-21: created from PR #44 review (data-integrity + security). Findings-only; not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/44
- Code: `src/modules/offerings/clearing.ts:100-110`
- Runbook: `docs/solutions/deployment-issues/2026-08-20-tov160-settlement-deploy-runbook.md` (§7)

---

## Resolution (COMPLETE — 2026-08-21)
User-confirmed "Add assertion too" (Option A). Both items applied:
- **Input-positivity guard in `computeClearing`** (`src/modules/offerings/clearing.ts`, right after the `publicFloat > 0` check): a fail-fast loop throwing `RangeError` on any `count <= 0` (`"bid N has a non-positive count"`) or `priceStroops < 0` (`"bid N has a negative price"`). The zero-count case is the load-bearing one — a 0-count `== P` bidder that drew a dust `+1` would exceed its own count and violate the on-chain `CHK_bid_won_alloc`; the guard makes the pure function self-defending under any future/less-trusted caller (upstream DB CHECKs mean it never fires in production). `RangeError` is already the terminal-settle class, so a garbage book fails settle cleanly rather than mis-allocating. Added unit test `#343` (zero count, negative count, negative price all throw).
- **Runbook §7 drain SQL tightened** to `WHERE status='subscribed' AND settle_failed_at IS NULL`, so "must return 0 rows" is the literal go/no-go and no longer reads as contradicting the prose (a resolved `settle_failed_at` terminal is not mid-settle). Prose updated to match.

Verified: build TSC 0, lint 0 warnings, `clearing.spec.ts` 34/34 green (incl. the new `#343` test).
