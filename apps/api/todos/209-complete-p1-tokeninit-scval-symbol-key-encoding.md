---
status: complete
priority: p1
issue_id: 209
tags: [code-review, soroban, correctness, TOV-233, PR-32]
dependencies: []
---

# TokenInit ScVal encodes struct keys as scvString; Soroban requires scvSymbol → every real deploy reverts

## Problem Statement
The `buildTokenInitScVal` encoder produces an ScMap whose keys are a mix of `scvSymbol` (4 numeric
fields) and `scvString` (the other 13 fields). Soroban decodes a `struct` from an ScMap whose keys are
ALL `ScSymbol`; an `ScString`-keyed map fails host conversion (`UnexpectedType`) and the `deploy`
call reverts. This is the single most important finding in the PR: every real on-chain deploy reverts,
and the fake-backed test suite structurally cannot catch it.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` `buildTokenInitScVal` (~lines 190-221) uses `nativeToScVal(obj, { type: {...} })`, but the `type` map only lists the 4 numeric fields, so ONLY those get `scvSymbol` map keys.
- The other 13 fields — `artwork_id`, `name`, `symbol`, `proxy_admin`, `artist`, `artist_payout`, `treasury`, `kyc_allowlist`, `freeze_set`, `marketplace_settler`, `minter`, `usdc`, `impl_wasm_hash` — get `scvString` keys by SDK default.
- A Soroban `struct` decodes from an ScMap whose keys are ALL `ScSymbol` → an `ScString`-keyed map fails host conversion (`UnexpectedType`) and `deploy` reverts. Empirically verified against the installed `@stellar/stellar-sdk`.
- CI is green because all suites run against `FakeFractionFactoryService`, so this cannot be caught without a live-testnet or golden-vector-XDR test.
- The code comment on ~line 189 says "declaration order — storage.rs", which is misleading: the SDK auto-sorts map keys alphabetically (order is fine); the real invariant is key TYPE (symbol), not order — the comment must be fixed too.

## Proposed Solutions
### Option A (recommended): explicit symbol key types for all 17 fields + golden-vector test
- Give every one of the 17 fields an explicit `['symbol', <valtype>]` type entry (bytes/string/address/i128/u64) so every map key is emitted as `scvSymbol`.
- Add a golden-vector unit test pinning the encoded XDR so a regression is caught in CI.
- Run the gated live-testnet test (`RELAYER_LIVE_TESTNET=1`) green before merge.
- Fix the misleading "declaration order" comment: the invariant is key TYPE (symbol), not declaration order.

**Effort: Small.**

## Recommended Action
**RESOLVED (Option A).** Every one of the 17 `TokenInit` fields now carries an explicit `['symbol', <valueType>]` type entry (bytes/string/address/i128/u64), so `nativeToScVal` emits an `ScMap` with all-`scvSymbol` keys. Verified empirically against the installed `@stellar/stellar-sdk`: 17 entries, key types = `['scvSymbol']`, 0 non-symbol (previously 13 were `scvString`). The misleading "declaration order" comment was corrected to state the real invariant (all keys symbol; SDK auto-sorts). A golden-vector unit test pinning this is added in todo 224; the gated live-testnet check (todos/102) remains the final on-chain proof.

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (`buildTokenInitScVal`, ~lines 189-221).

## Acceptance Criteria
- [ ] All 17 TokenInit fields encode their ScMap key as `scvSymbol` (not `scvString`).
- [ ] A golden-vector unit test pins the encoded TokenInit XDR and fails on any key-type regression.
- [ ] The gated live-testnet deploy test (`RELAYER_LIVE_TESTNET=1`) passes before merge.
- [ ] The misleading "declaration order — storage.rs" comment is corrected to describe the key-type invariant.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — all 17 keys now scvSymbol (verified via SDK); golden-vector test in todo 224.
