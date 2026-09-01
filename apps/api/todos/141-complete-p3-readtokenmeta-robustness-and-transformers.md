---
status: complete
priority: p3
issue_id: 141
tags: [code-review, typescript, security, export, TOV-40]
dependencies: [129]
---

# readTokenMeta robustness (clamp symbol, simplify decimals narrowing) + dedupe bigint ledger transformer

## Problem Statement
Small quality/robustness items around token metadata + entity transformers:
1. `assetCode`/`displayName` come from on-chain `symbol()` with no length cap before being echoed in `ExportItemDto`. Fraction contracts are platform-controlled today, but an unbounded symbol is a latent reflected-content vector if a fraction contract were ever attacker-influenced.
2. The decimals narrowing `typeof decimals === 'number' ? decimals : Number(decimals ?? 0) || 0` is convoluted; the `|| 0` collapses a legit `0` and `NaN` to the same value.
3. `expires_at_ledger` and `ledger` use an identical inline `bigint→Number` transformer literal, duplicated, with no bounded-range comment (contrasts with the careful BigInt-string handling for `amount_scaled`).

## Findings
- `src/modules/relayer/soroban-relayer.service.ts:340-344` — unbounded symbol + convoluted decimals narrowing.
- `src/modules/wallets/export/entities/wallet-export-item.entity.ts:42-43,49-50` — duplicated `Number()` transformer, no range comment.

## Proposed Solutions

### Option A: Clamp symbol (≤32), simplify decimals, extract a named ledger transformer
- **Description:** Clamp `symbol` length in `readTokenMeta` (or when building `assetCode`); simplify to `typeof decimals === 'number' && Number.isInteger(decimals) ? decimals : 0`; factor a single `ledgerNumberTransformer` const with a bounded-range comment (or `Number.isSafeInteger` guard).
- **Pros:** Removes a latent reflected-content risk; clearer intent; DRY.
- **Cons:** None material.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Only the ledger-transformer dedupe remains — the readTokenMeta items are moot (removed in [[129]]).

## Implemented Solution
The `symbol()`-clamp and decimals-narrowing items are **no longer applicable**: [[129]] removed
`readTokenMeta`/`simulateRead` entirely (token metadata is now config-driven, so there is no on-chain
symbol/decimals read to bound). `assetCode`/`displayName` now come from a validated config var
(`RELAYER_FRACTION_TOKENS`, Joi-checked in [[133]]), not attacker-influenceable contract output.

The remaining item — the duplicated inline `bigint -> number` transformer on the two ledger columns — is
extracted into a single named `ledgerNumberTransformer` const with a bounded-range comment (a ledger seq
is far below 2^53, so `Number()` is safe; contrasted with `amount_scaled` staying a BigInt string).

## Technical Details
Affected: `src/modules/wallets/export/entities/wallet-export-item.entity.ts` (shared transformer).

## Acceptance Criteria
- [x] `assetCode`/`displayName` are bounded — now config-sourced + Joi-validated (readTokenMeta removed in 129).
- [x] The bigint ledger transformer is a single named const with a range note.

## Work Log
- 2026-07-14: Filed from PR #25 review (typescript + security reviewers).
- 2026-07-15: readTokenMeta items moot (removed in 129); extracted the shared ledger transformer. build + lint + 10 e2e green. Marked complete.
