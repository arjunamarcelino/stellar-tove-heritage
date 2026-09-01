---
status: complete
priority: p2
issue_id: 340
tags: [code-review, documentation, architecture, tov-162]
dependencies: []
---
# CLAUDE.md offerings entry is stale after TOV-162 (contradicts the shipped clearing algorithm)

## Problem Statement
`src/modules/CLAUDE.md` is the onboarding/architecture doc loaded into agent context each session. Its `offerings/` bullet documents TOV-152/154/156/158/160 but has **no TOV-162 entry**, and — worse — its TOV-160 clause now **actively misdescribes the shipped `clearing.ts`** after PR #44. An onboarding doc that contradicts the code is a correctness hazard for every future change to this money path, hence p2 (not p3).

## Findings
Source: pattern-recognition-specialist (PR #44 review). `src/modules/CLAUDE.md:56` (the `offerings/` bullet) currently states:
> "The **pure `clearing.ts`** … does the BigInt walk (`price DESC, created_at ASC, id ASC`) → P = marginal winner price, marginal partial-fills; `assertClearingInvariants` is the fail-fast belt (band, `Σ allocated == public_float`, i128/`MAX_I128` overflow, **and an INDEPENDENT optimality belt: P == min winner price + every loser ≤ P** …)"

Three concrete drifts vs the committed code (`src/modules/offerings/clearing.ts`):
1. **Tiebreak** — doc says `created_at ASC, id ASC`; code now sorts `(price DESC, created_at ASC, chainBidId ASC)` (D4′ — the whole point of TOV-162). The DB scan order stays `id ASC` (stable-scan), which is a distinction the doc should now draw.
2. **Allocation method** — doc says "P = marginal winner price, marginal partial-fills"; code now does tiered Hamilton/largest-remainder **pro-rata** among the `== P` bidders with FCFS-by-`(created_at, chainBidId)` dust. The single-marginal-partial-fill is gone.
3. **Belt inventory** — doc lists only the optimality belt; the new **independent pro-rata belt** (`clearing.ts:318-373`) is absent.

## Proposed Solutions
### Option A — Append a TOV-162 sentence + correct the three stale phrases
- Description: Add a TOV-162 clause to the `offerings/` bullet describing the over-subscription pro-rata at the clearing tier (floor + FCFS dust by `(created_at, chainBidId)`, zero-alloc `==P` bidders excluded/refunded), the `id → chainBidId` tiebreak with the DB `id ASC` stable-scan divergence, and the new independent pro-rata belt. Fix the three drifted phrases in the TOV-160 clause so they read as "was marginal-partial-fill under TOV-160, now pro-rata under TOV-162" (or simply update to the current behavior).
- Pros: Onboarding doc matches code; future changes start from truth.
- Cons: The bullet is already very long; adds a few more lines.
- Effort: Small
- Risk: Low

### Option B — Minimal correction only (fix the 3 drifted phrases, no new TOV-162 prose)
- Description: Just correct tiebreak/allocation/belt phrases in place to current behavior; skip a dedicated TOV-162 narrative.
- Pros: Smallest diff; removes the contradiction.
- Cons: Loses the "why pro-rata / D4′" context that the other TOV-xxx clauses provide for their features.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — the bullet already carries a per-ticket narrative for TOV-152/154/156/158/160; a TOV-162 clause keeps that pattern and documents the D4′ tiebreak rationale (which is subtle and will otherwise be re-discovered the hard way).

## Technical Details
- Affected file: `src/modules/CLAUDE.md` (the `offerings/` bullet, ~line 56). No code change.
- Cross-references that are already correct in code (do NOT change): the DB query genuinely orders `id ASC` (`offering-bid.repository.ts`), so any doc mention of the *DB* order should stay `id ASC` while the *algorithm* tiebreak is `chainBidId`.
- NOT a protected artifact (this is `src/modules/CLAUDE.md`, not `docs/plans/` or `docs/solutions/`).

## Acceptance Criteria
- `src/modules/CLAUDE.md` `offerings/` bullet mentions TOV-162 over-subscription pro-rata.
- No phrase in that bullet claims the clearing algorithm does a single "marginal partial-fill" or sorts by `id ASC` as its tiebreak.
- The independent pro-rata belt is listed alongside the optimality belt.

## Work Log
- 2026-08-21: created from PR #44 review (pattern-recognition-specialist). Findings-only; not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/44
- Code: `src/modules/offerings/clearing.ts:318-373` (pro-rata belt), `:110-194` (pro-rata Pass 1)
- Plan: `docs/plans/2026-08-21-feat-oversubscription-pro-rata-clearing-plan.md`

---

## Resolution (COMPLETE — 2026-08-21)
Option A applied to `src/modules/CLAUDE.md` (`offerings/` bullet). Two edits:
1. **Corrected the TOV-160 clearing clause** — the walk description now reads `price DESC, created_at ASC, chainBidId ASC` (the algorithm's authoritative tiebreak since TOV-162) with an explicit note that the DB scan stays `id ASC` as a stable-scan detail and the walk re-sorts; the "marginal partial-fills" phrase now points forward to the pro-rata clause instead of asserting single-marginal-fill as current behavior.
2. **Appended a TOV-162 (FR-05.05b) clause** documenting: over-subscription pro-rata at the `== P` tier (Hamilton/largest-remainder floors + FCFS-by-`(created_at, chainBidId)` dust), zero-alloc `==P` bidders excluded/refunded as `lost`, `Σ allocated == public_float` ⇒ no migration/contract/endpoint change (proceeds/fee/net byte-identical since `proceeds = P·float`), the `id → chainBidId` tiebreak rationale (D4′: `id` absent from `bids_snapshot`), and the new independent pro-rata belt with its own re-sort. Cross-refs PR #44, the plan, and runbook §7.

The onboarding doc now matches the shipped `clearing.ts`. No code change. Verified the corrected clause no longer claims `id ASC` as the algorithm tiebreak or a single "marginal partial-fill" as current behavior, and the pro-rata belt is listed alongside the optimality belt.
