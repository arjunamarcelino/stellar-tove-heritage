---
status: complete
priority: p3
issue_id: 336
tags: [code-review, typescript, tov-160]
dependencies: []
---
# TypeScript polish: nested ReturnType alias, loose contract-error regex, param naming

## Problem Statement
Three TypeScript-quality nits in the settle Soroban adapter and processor (TOV-160). None affects runtime behavior; all are readability/robustness improvements. One (the loose regex) becomes materially more important once todo 317 makes the parsed contract code drive control flow.

## Findings
- **(1) DOUBLY-NESTED `ReturnType`** — `src/modules/offerings/escrow/soroban-offering-escrow.service.ts`: the expression `ReturnType<ReturnType<typeof rpc.assembleTransaction>['build']>` appears verbatim in both `buildSimulateAssemble` and `sendAndPoll` signatures. It is just the SDK `Transaction` type. Extract a single `type PreparedTx = ...` alias (or import/annotate the SDK `Transaction` directly). Also, `buildSimulateAssemble` returns `{ prepared }` — a single-field wrapper — so it can return the tx directly.
- **(2) LOOSE `parseContractErrorCode` FALLBACK** — the fallback `/#(\d+)/` will latch onto any unrelated `#n` in the error string (a budget line, a ledger ref), not only a contract error code. Tolerable **today** only because `contractCode` is diagnostic: `OfferingSettleContractError` is always `retryable: false`, so a mis-parse never changes money control-flow. But **once todo 317 makes this drive `close_offering` classification**, tighten the regex (anchor it to the contract-error shape) or drop the loose fallback so a non-contract revert parses to `null`.
- **(3) NAMING** — in `src/modules/offerings/offering-settle.processor.ts`: the parameter destructured as `on: { txHash, ledger, adopted }` reads as the preposition "on" → rename to `chainResult` / `onChain`. And `const res = await closeAndSettle(...)` sits one letter apart from `result` (the clearing result) in the same scope → rename to `settleRes` to avoid the `res`/`result` confusion.

## Proposed Solutions
### Option A — Apply all three nits
- Description: Extract `type PreparedTx`, unwrap the single-field `{ prepared }` return, tighten/anchor the contract-error regex (or drop the loose fallback), and rename `on`→`chainResult` and `res`→`settleRes`.
- Pros: Cleaner signatures, safer parse when 317 lands, clearer local names.
- Cons: Small diff churn.
- Effort: Small
- Risk: Low

### Option B — Do naming + alias now, defer the regex to todo 317
- Description: Ship (1) and (3) with this cleanup; fold the regex tightening into 317's work where it becomes load-bearing.
- Pros: Keeps the regex change coupled to the change that makes it matter (avoids a speculative tighten that could mis-narrow).
- Cons: Leaves the loose fallback until 317.
- Effort: Small
- Risk: Low

## Recommended Action
Option B — extract `PreparedTx`, unwrap the `{ prepared }` return, and do the two renames now; tighten `parseContractErrorCode` as part of todo 317 (where the parsed code starts driving classification), so the regex is hardened exactly when it stops being purely diagnostic.

## Technical Details
- DEPENDENCY: item (2) interacts with **todo 317** (`close_offering` NotOpen classified terminal) — the regex must be tightened before/with that change so a non-contract revert yields `null` rather than a spurious code that could steer classification.
- The SDK `Transaction` type can likely be imported from `@stellar/stellar-sdk` (or the rpc namespace) instead of reconstructed via nested `ReturnType`.

## Acceptance Criteria
- The nested `ReturnType<ReturnType<...>>` expression appears at most once (as a named alias) or is replaced by the imported SDK type.
- `parseContractErrorCode` returns `null` for a non-contract revert string (asserted in unit tests) — closed either here or in 317.
- No `on`/`res` shadow-ish local names remain in the settle processor.

## Work Log
- 2026-08-20: created from PR #43 review (kieran-typescript-reviewer)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Three TS-quality items: (1) Extracted `type PreparedTx = ReturnType<ReturnType<typeof rpc.assembleTransaction>['build']>`
once and referenced it in both `buildSimulateAssemble` + `sendAndPoll` signatures (was the nested chain
duplicated verbatim). (2) Tightened `parseContractErrorCode` to match ONLY the canonical `Error(Contract, #n)`
shape — dropped the loose `/#(\d+)/` fallback that could latch onto a stray `#n`, which matters now that #317
makes it drive control flow; added `soroban-escrow-helpers.spec.ts` (exact-match + non-contract-revert→null).
(3) Renamed `res`→`settleRes` (beside `result`) and the persist `on`→`chainResult` param for readability.
Build green; processor + settle-args + new helper spec all pass.
