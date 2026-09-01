---
status: complete
priority: p2
issue_id: 222
tags: [code-review, typescript, correctness, TOV-233, PR-32]
dependencies: []
---

# isSequenceError casts unknown through a fabricated call-signature; a SDK shape change silently misclassifies txBadSeq as terminal

## Problem Statement
`isSequenceError` casts the SDK's `errorResult` through a fabricated call-signature type instead of its real typed shape. If the SDK renames the accessor, the code still compiles and silently returns false, misclassifying a `txBadSeq` as a hard failure so the row never retries the sequence path.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` ~lines 237-244 casts `errorResult as { result?: () => { switch: () => { name: string } } }`.
- `sendTransaction`'s `errorResult` is a typed `xdr.TransactionResult | undefined`, not unknown.
- If the SDK renames `.result()` / `.switch()`, this compiles and silently returns false → a `txBadSeq` is misclassified as a hard failure and the row never retries the sequence path (deploy stuck/failed).

## Proposed Solutions
### Option A (recommended): use the real SDK type and accessor
- Type the param `xdr.TransactionResult | undefined` and read the real accessor (guard the union arm via `.switch().name === 'txBadSeq'`).
- Keep try/catch as belt-and-suspenders but make the type real.
- Confirm the accessor against the installed SDK.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A).** Typed the parameter `isSequenceError(errorResult?: xdr.TransactionResult)` and read `errorResult?.result().switch().name === 'txBadSeq'` directly off the SDK XDR union instead of casting `unknown` through a fabricated `{ result?: () => ... }` shape. Kept the `try/catch` as a belt against an unexpected union arm. A future SDK accessor rename now fails the TypeScript build rather than silently returning `false` (which would misclassify a `txBadSeq` as a hard failure and skip the sequence retry).

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (~lines 237-244).
- `errorResult` is `xdr.TransactionResult | undefined`; the fabricated call-signature cast defeats the compiler's ability to catch an SDK shape change.

## Acceptance Criteria
- [ ] The param is typed `xdr.TransactionResult | undefined` (no fabricated call-signature cast).
- [ ] The `txBadSeq` check reads the real accessor and is verified against the installed SDK.
- [ ] A future SDK accessor rename causes a compile error rather than a silent misclassification.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — typed against `xdr.TransactionResult`; build green.
