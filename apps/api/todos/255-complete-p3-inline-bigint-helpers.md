---
status: complete
priority: p3
issue_id: 255
tags: [code-review, simplicity, TOV-237, PR-35]
dependencies: []
---

# Simplify: the `minBig`/`maxBig`/`computeFree` trio is over-split

## Problem Statement
Three one-line bigint helpers each have a single caller; the indirection adds a layer without readability benefit. `parseAmount` (the genuinely reusable, tested guard) is the only thing that needs a home in `amount.ts`.

## Findings
Flagged by code-simplicity-reviewer (P2-1; scoped P3 — minor).
- `amount.ts:19-23` — `maxBig` used once (inside `computeFree` one line below); `minBig` used once (`me-holdings.service.ts:139`); `computeFree` used once (`me-holdings.service.ts:107`).
- Inlining reads better at the call site: `computeFree(balance, locked)` → `balance - locked < 0n ? 0n : balance - locked`; `minBig(balance, retention)` → `balance < retention ? balance : retention`.

## Proposed Solutions
1. Inline the three; keep `parseAmount` in `amount.ts`. Removes 3 exports + a layer. Effort: Small. Risk: none.
2. Keep as-is (harmless), tracked. The "free is never negative" clamp arguably reads fine behind `computeFree` — reasonable people differ.

## Recommended Action
**RESOLVED — Solution 1.** Inlined all three one-use helpers: `computeFree(balance, locked)` → `balance - locked < 0n ? 0n : balance - locked` (with a `// free is never negative` comment) at the build site; `minBig(balance, retention)` → `balance < retention ? balance : retention` (`// locked is capped at the actual balance`) in `artistLockedAmount`. Removed `minBig`/`maxBig`/`computeFree` from `amount.ts` (kept the reusable, twice-used `parseAmount`) and dropped their now-redundant `amount.spec` cases — the clamp/min behavior stays covered by the service spec's min-drift + collector edge cases.

## Technical Details
- `amount.ts`, `me-holdings.service.ts`, `test/unit/modules/me-holdings/amount.spec.ts`.

## Acceptance Criteria
- [x] Inlined; `amount.ts` keeps only `parseAmount`; tests updated and green.

## Work Log
- 2026-07-18: created from PR #35 review (code-simplicity-reviewer P2-1).
- 2026-07-18: RESOLVED — inlined the three helpers; build + lint + 35 holdings tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
