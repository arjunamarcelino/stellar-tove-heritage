---
status: complete
priority: p2
issue_id: 323
tags: [code-review, typescript, tov-160]
dependencies: []
---
# `ClearingResult.clearingPriceStroops` is `string | null`, forcing `as string` casts that hide a future null-on-chain bug

## Problem Statement
`ClearingResult.clearingPriceStroops` is typed `string | null` (null when undersubscribed). At settle time the null is genuinely impossible — `assertClearingInvariants` throws on a null price before any money moves — but because that assert is a plain `void` function, TypeScript cannot see the narrowing, so the settle processor reaches for `result.clearingPriceStroops as string` at two money sites. The cast COMPILES regardless of control flow: if someone later reorders the assert below the `close_and_settle` call (or drops it), the `as string` still type-checks and a `null` price silently becomes the string `"null"` (or `BigInt(null as any)` throwing at best, `"null"` persisted at worst) on-chain / in the audit snapshot. The backoffice service does the equivalent narrowing WITHOUT a cast — an explicit `=== null` throw narrows the union for free — proving the cast is avoidable.

## Findings
- `src/modules/offerings/clearing.ts:52-54` — `clearingPriceStroops: string | null` on `ClearingResult`.
- `src/modules/offerings/clearing.ts:185-191` — `assertClearingInvariants(...): void` — returns `void`, so its internal `if (!result.fullySubscribed || result.clearingPriceStroops === null) throw` (line 195) does NOT narrow at the call site.
- `src/modules/offerings/settle/offering-settle.processor.ts:144` — `clearingPrice: BigInt(result.clearingPriceStroops as string)` (the `close_and_settle` arg — the money site).
- `src/modules/offerings/settle/offering-settle.processor.ts:201` — `clearingPriceStroops: result.clearingPriceStroops as string` (the persisted audit snapshot).
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — the clearing-preview path narrows via an explicit `=== null` throw and uses the value cast-free, the pattern to converge on.

## Proposed Solutions
### Option A — Make `ClearingResult` a discriminated union on `fullySubscribed` (BEST)
- Description: Split into `{ fullySubscribed: true; clearingPriceStroops: string; winners: ClearingWinner[]; … }` | `{ fullySubscribed: false; clearingPriceStroops: null; winners: []; … }`. Every existing `if (!result.fullySubscribed) throw` (the assert, and the preview's guard) then narrows to the `true` arm automatically, so `clearingPriceStroops` is `string` at all settle sites and both `as string` casts delete.
- Pros: Removes both casts AND makes the type model the real invariant ("a fully-subscribed result HAS a price"); every consumer that already gates on `fullySubscribed` gets narrowing for free; the undersubscribed arm's `winners: []` / zeroed money fields become type-enforced.
- Cons: Touches the `computeClearing` return construction (two `return` sites) and any consumer that reads price/winners without first checking `fullySubscribed`; the discriminant must be checked before the money fields (already the case in practice).
- Effort: Small
- Risk: Low

### Option B — Give `assertClearingInvariants` an assertion signature
- Description: Change its signature to `asserts result is ClearingResult & { clearingPriceStroops: string }` (an assertion function). After the call, TS narrows `clearingPriceStroops` to `string` and the two casts delete — without restructuring the type.
- Pros: Minimal diff (signature + the same body); the narrowing is tied to the assert actually running, so reordering the assert below the settle call becomes a compile error at the now-uncast use.
- Cons: Only narrows in code paths that call the assert (the preview path narrows separately); does not model the invariant in the type itself the way A does; assertion signatures require the function to be a non-arrow declaration (already is).
- Effort: Small
- Risk: Low

## Recommended Action
Option A — convert `ClearingResult` to a discriminated union on `fullySubscribed` so every `if (!fullySubscribed) throw` narrows automatically and both `as string` casts in the settle processor become cast-free. If A proves too invasive for this PR, Option B (assertion signature on `assertClearingInvariants`) is the lighter fallback that still deletes the casts and makes an assert-reorder a compile error.

## Technical Details
The two `as string` casts are safe TODAY only because the assert precedes them and throws on null; the risk is entirely about future edits surviving the compiler. Under Option A, `computeClearing`'s undersubscribed `return` (clearing.ts:125-136) becomes the `fullySubscribed: false` arm and the subscribed `return` (160-169) the `true` arm; consumers reading `winners`/`proceedsStroops` off an unchecked result would then need to gate on `fullySubscribed` first (which they already do). Verify the audit-snapshot persist (processor.ts:199-212) and the `OFFERING_SETTLED` audit payload (213-227) read the now-`string` field cast-free.

## Acceptance Criteria
- Neither settle-processor money site uses `as string` on `clearingPriceStroops` (both narrow structurally).
- Reordering `assertClearingInvariants` below the `close_and_settle` call (or the equivalent narrowing check) is a COMPILE error, not a silently-passing cast (demonstrable by a temporary local edit during review).
- The undersubscribed result shape enforces `clearingPriceStroops: null` + `winners: []` at the type level (Option A) or the assert narrows to `string` (Option B).
- Existing clearing + settle unit suites stay green.

## Work Log
- 2026-08-20: created from PR #43 [kieran-typescript-reviewer] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Chose the lighter of the two proposed options (assertion signature over a full discriminated union — less
churn, same guarantee). `assertClearingInvariants` now returns
`asserts result is ClearingResult & { clearingPriceStroops: string }`, so after the worker calls it, TS
narrows `result.clearingPriceStroops` to `string` automatically. Removed both `as string` casts in
`offering-settle.processor.ts` (the `closeAndSettle` clearingPrice arg and the snapshot insert) and typed
`persist()`'s `result` param as the narrowed type so the narrowing carries across the call. Now if anyone
reorders the assert below the settle call, it's a compile error instead of a silent `"null"` reaching the
chain. Build green (TSC 0 issues).
