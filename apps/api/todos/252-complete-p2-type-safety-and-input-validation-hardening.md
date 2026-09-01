---
status: complete
priority: p2
issue_id: 252
tags: [code-review, typescript, correctness, TOV-237, PR-35]
dependencies: []
---

# Type-safety & input-validation hardening bundle (4 small items)

## Problem Statement
Four spots discard compiler/validation protection the code otherwise builds in. Each is small; together they restore "let the types/validation enforce the invariant."

## Findings
Flagged by kieran-typescript-reviewer (P1.1, P1.2, P2.1, P2.2 — scoped P2 here; none block merge).
1. **`restorePreamble` cast defeats itself** — `soroban-fraction-read.service.ts:76`: `(sim as { restorePreamble?: unknown }).restorePreamble`. After `isSimulationSuccess(sim)` narrows `sim` to the success type, `sim.restorePreamble` is directly typed; the cast widens it away and would silently keep compiling on an SDK field rename. Drop the cast.
2. **`tokenAddress as string` x3** — `me-holdings.service.ts:89,100,113`. Entity types `tokenAddress: string | null`; the `.filter(c => c.tokenAddress !== null)` at `:54` is runtime-safe but the array stays typed nullable, forcing casts. Use a type-predicate filter (`(c): c is FractionContract & { tokenAddress: string } => c.tokenAddress !== null`) to erase all three casts and make a future null-reintroduction a compile error.
3. **Unvalidated cache shape** — `holdings-cache.ts:50`: `JSON.parse(raw) as HoldingDto[]`. `JSON.parse` is `any`; a poisoned/truncated/version-skewed value flows to the HTTP response as a "valid" array. The fail-open `try/catch` catches parse errors, not shape errors. Add `Array.isArray(parsed)` (min) → return `null` (fail-open to live read) on mismatch.
4. **`parseAmount` accepts negative *balances*** — `amount.ts:4` (`/^-?\d+$/`) + call site `me-holdings.service.ts:100`. A `-5` on-chain balance is a decode/corruption signal, not a holding, yet it passes: kept (≠0), `computeFree(-5n,0n)=0n` → surfaces `{balance:'-5', freeBalance:'0'}`. Add a non-negative parse variant (or `parseBalance`) for the balance call site; keep signed parse where genuinely wanted.

## Proposed Solutions
1. Apply all four (independent, each ~1–3 lines + a test). Effort: Small. Risk: low.
2. Split #4 out if a signed balance is ever legitimately expected (it isn't for a u128 balance).

## Recommended Action
**RESOLVED — all four applied.**
1. `restorePreamble` — replaced the `as { restorePreamble?: unknown }` cast with the SDK's own `rpc.Api.isSimulationRestore(sim)` type guard (a field rename now breaks the build). Added `isSimulationRestore` to the adapter test mock.
2. `tokenAddress` — added a `DeployedContract = FractionContract & { tokenAddress: string }` alias and a type-predicate filter (`(c): c is DeployedContract => c.tokenAddress !== null`); `buildHoldings` takes `DeployedContract[]`. All three `as string` casts removed.
3. Cache shape — `holdings-cache.get` now parses into `unknown`, returns `null` (fail-open) unless `Array.isArray(parsed)`.
4. Negative balance — `parseAmount` gained `{ nonNegative?: boolean }`; the balance call site passes `{ nonNegative: true }`, so a `-N` decode → `FractionReadUnavailableError` → 503 instead of a bogus row. Added unit tests.

## Technical Details
- `soroban-fraction-read.service.ts`, `me-holdings.service.ts`, `holdings-cache.ts`, `amount.ts`; tests `amount.spec.ts`, `soroban-fraction-read.service.spec.ts`.

## Acceptance Criteria
- [x] `restorePreamble` cast removed; uses SDK type guard.
- [x] No `as string` on `tokenAddress`; type-predicate filter used.
- [x] Cache `get` shape-guards (`Array.isArray`) and fails open on mismatch.
- [x] Negative balance rejected as a read failure.

## Work Log
- 2026-07-18: created from PR #35 review (kieran-typescript-reviewer).
- 2026-07-18: RESOLVED — all four hardened; build + 38 holdings unit tests green; grep confirms no stale casts.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
