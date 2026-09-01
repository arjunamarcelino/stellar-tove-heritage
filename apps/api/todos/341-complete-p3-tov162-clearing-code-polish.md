---
status: complete
priority: p3
issue_id: 341
tags: [code-review, simplicity, typescript, tov-162]
dependencies: []
---
# clearing.ts pro-rata polish: redundant belt check, extra atP pass, double BigInt parse, mutation style

## Problem Statement
Four readability/altitude nits in the committed `computeClearing` + `assertClearingInvariants` (PR #44). None affects correctness, money-safety, or performance (the book is bounded by MAX_BIDS ~tens). Grouped as one optional polish pass.

## Findings
Sources: code-simplicity-reviewer, kieran-typescript-reviewer, performance-oracle (PR #44 review). All in `src/modules/offerings/clearing.ts`.

- **(F5, p3) Redundant optimality "loser > P" loop now subsumed by the pro-rata full-fill check.** The optimality belt's `losing bid priced > P` scan (`:312-316`) is a strict subset of the new pro-rata block (a): any `> P` bid not a full winner already trips `winnerAlloc.get(id) !== count` → "not fully filled" (`:335-336`), which is *stronger* (it also rejects a present-but-under-filled `> P` winner the loser loop skips). The loser loop catches nothing the pro-rata block misses. **Keep-or-drop call:** it is two independently-authored belts with distinct error messages (defense-in-depth on a money path) — dropping it shortens the belt but removes a redundant safety net. Recommendation leans **keep** (money code); documented here so the redundancy is a conscious choice, not an oversight.
- **(F3, p3) Pass 1c makes 4 passes over `atP` where 3 suffice.** Base-assign (`:179-181`), dust-sum `reduce` (`:182`), dust `+1` loop (`:183-189`), winners-push (`:192-194`). The `reduce` at `:182` re-sums the `allocated` values just assigned at `:179-181`; accumulate that sum inline in the first loop to remove one pass. Cosmetic (atP is tiny).
- **(TS, p3) In-place mutation of `atP[].allocated`.** `atP` is seeded `allocated: 0n` then mutated three times (`:180`, `:187`, read `:193`). Safe (contained local, never returned/aliased), but it is the one mutation-heavy spot and diverges in style from the belt's functional `bases`/`dust` derivation (`:356-364`). Optional functional rewrite would mirror the belt.
- **(perf+TS, p3) Double `BigInt(b.count)` parse in the belt's `> P` branch** (`:334-335`, back-to-back) and again across `:339`/`:356`. A single `const count = BigInt(b.count)` at the loop-body top DRYs it. Perf-nil at this n; pure readability. (The *cross-function* re-parse from `bidsSnapshot` is deliberate belt independence — do NOT collapse that.)

## Proposed Solutions
### Option A — Apply the three pure-cleanup nits (F3, mutation-style, double-parse), leave F5
- Description: Inline the dust-sum accumulation, optionally rewrite Pass 1c functionally, add `const count` in the belt loop. Keep the redundant loser loop as documented defense-in-depth.
- Pros: Tighter, more consistent with the belt's style; no behavior change.
- Cons: Small diff churn on a money-path file (re-review cost).
- Effort: Small
- Risk: Low (unit + fuzz + e2e must stay green)

### Option B — Leave as-is (document only)
- Description: Accept all four as intentional/acceptable; this todo is the record.
- Pros: Zero risk on a verified money path.
- Cons: Minor altitude/consistency debt persists.
- Effort: None
- Risk: None

## Recommended Action
Option A for the double-parse `const count` and the F3 inline-sum (trivially safe, strict readability wins); leave F5 (keep the redundant belt as defense-in-depth) and treat the Pass-1c functional rewrite as optional. Re-run unit/fuzz/e2e after any change.

## Technical Details
- Affected file: `src/modules/offerings/clearing.ts` only.
- Guardrail: the belt must remain an **independent** re-derivation — do not extract a shared pro-rata helper used by both the production path and the belt (would defeat recompute-and-compare). This constrains any "DRY" refactor.

## Acceptance Criteria
- If applied: `computeClearing` Pass 1c sums dust inline (no separate `reduce` re-walk); the belt's `> P` branch parses `BigInt(b.count)` once per row.
- Belt independence preserved (no shared production/belt pro-rata helper).
- `yarn test` (incl. PR-FUZZ) + integration + e2e stay green.

## Work Log
- 2026-08-21: created from PR #44 review (simplicity + typescript + performance). Findings-only; not fixed per instruction.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/44
- Code: `src/modules/offerings/clearing.ts:179-194` (Pass 1c), `:312-316` (loser loop), `:331-373` (pro-rata belt)

---

## Resolution (COMPLETE — 2026-08-21)
User-confirmed: **KEEP** the redundant loser-loop (F5) as defense-in-depth; apply the pure cleanups. Applied to `src/modules/offerings/clearing.ts`:
- **F5 (keep + document):** left the optimality "loser priced > P" loop in place; added a comment on the pro-rata `(a)` check noting it is a STRONGER, intentionally-redundant restatement (also rejects a present-but-under-filled `>P` winner) — two independently-derived belts with distinct error messages on the money path, kept on purpose.
- **F3 (inline dust-sum):** Pass 1c now accumulates `allocatedSoFar` inside the base-assignment loop instead of a separate `atP.reduce(...)` re-walk — one fewer pass over `atP`.
- **double-parse (perf/TS):** the belt's snapshot loop now binds `const count = BigInt(b.count)` once per row (was parsed twice back-to-back in the `> P` branch).

**Left as-is (deliberately):** the `atP[].allocated` in-place mutation (safe, contained local; a functional rewrite was optional and skipped to minimize money-path churn); the cross-function re-parse from `bidsSnapshot` in the belt (required for belt independence — must NOT reuse the production `decorated`). Belt independence preserved (no shared production/belt pro-rata helper introduced). `yarn test test/unit/.../clearing.spec.ts` → 34/34 green (incl. PR-FUZZ).
