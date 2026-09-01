---
status: complete
priority: p3
issue_id: 278
tags: [code-review, typescript, quality, TOV-153, PR-38]
dependencies: []
---

# Avoidable `highPriceStroops!` non-null assertion in the preview service

## Problem Statement
`OfferingPreviewService.preview` derives the band via:

```ts
const band =
  query.lowPriceStroops !== undefined
    ? assertBandValid(query.lowPriceStroops, query.highPriceStroops!)
    : undefined;
```

The `highPriceStroops!` is *semantically* safe (the DTO's both-or-neither rule 400s a lone bound before
the service runs) and is documented — but it leans on a validator-layer invariant the compiler can't
see. Checking both bounds lets TS narrow `highPriceStroops` to `string` on its own, removing the one
non-null assertion in the feature with identical runtime behavior (the "only low" state is unreachable
post-validation):

```ts
const band =
  query.lowPriceStroops !== undefined && query.highPriceStroops !== undefined
    ? assertBandValid(query.lowPriceStroops, query.highPriceStroops)
    : undefined;
```

## Findings
- **kieran-typescript-reviewer (P3):** "Strictly better on the type-safety bar: it removes the one
  non-null assertion in the feature."
- Evidence: `src/modules/backoffice/artworks/offering-preview.service.ts:33` (the `highPriceStroops!`).

## Proposed Solutions
### Option A — Narrow on both bounds; drop the `!`
- **Pros:** no non-null assertion; compiler-proven narrowing; same behavior. **Cons:** none of note
  (a redundant-looking second check, but it is the thing that earns the narrow). **Effort:** Trivial.
  **Risk:** None.

### Option B — Keep the `!` (documented invariant)
- **Pros:** no change. **Cons:** the assertion the reviewer flagged remains. **Effort:** None.

## Recommended Action
**Option A — narrowed on both bounds; `!` removed.**

## Resolution
The band derivation now checks `query.low_price_stroops !== undefined && query.high_price_stroops
!== undefined`, so TS narrows `high` to `string` and the `!` assertion is gone. Behavior is identical
for all inputs the service can receive (the DTO's both-or-neither rule 400s a lone bound before the
service runs, so the "only low" branch is unreachable). The method now lives on
`BackofficeArtworksService.offeringPreview` (post todo 274 fold). Verified: build 0 issues, preview
unit spec green. (No `!` non-null assertions remain in the feature.)

## Technical Details
- `src/modules/backoffice/artworks/offering-preview.service.ts:31-37`

## Acceptance Criteria
- [ ] No `!` assertion on `highPriceStroops`; preview unit + e2e still green (partial band → 400,
      both → range, neither → float-only).

## Work Log
- 2026-08-19 — Raised by code-review (PR #38), kieran-typescript P3.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
