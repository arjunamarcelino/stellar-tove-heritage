---
status: complete
priority: p2
issue_id: 129
tags: [code-review, performance, architecture, export, TOV-40]
dependencies: []
---

# readTokenMeta: relocate off the money port + stop re-reading immutable metadata every initiate

## Problem Statement
Two overlapping concerns about `readTokenMeta` (token `decimals()`/`symbol()` for the confirm screen):
1. **RPC amplification:** it issues `getAccount` + `2N` simulate round-trips on EVERY `initiate` (and resume), for values that are immutable SEP-41 contract metadata. USDC's decimals is already a hardcoded constant that the code fetches then ignores. `readTokenMeta` alone is ~40% of the ~`5N` simulate calls per initiate.
2. **Layering:** it lives on the `RELAYER_SERVICE` port, whose identity is fail-CLOSED money operations. `readTokenMeta` is explicitly "display-only, never throws" — the opposite failure policy — diluting the money trust boundary and growing the fake for a non-relayer reason.

## Findings
- `src/modules/wallets/export/wallet-export.service.ts:102-104` calls it every initiate.
- `src/modules/relayer/soroban-relayer.service.ts:325-347` — `getAccount` + per-token `Promise.all([decimals, symbol])` = `2N` sims.
- Per-initiate RPC ≈ `(N+2)` getAccount + `5N` simulate; `readTokenMeta` = `2N` of those, on constants.
- `relayer.service.interface.ts:127-133` — a never-throwing display method on the fail-closed port.

## Proposed Solutions

### Option A: Config-drive / boot-memoize token metadata; move it off the relayer port
- **Description:** Ship `decimals`/`symbol` alongside each address in config (the fraction set is small + static), or memoize by `tokenContract` once. Drop `readTokenMeta` from the request path. Relocate any live lookup into a separate `TokenMetadataService`/`ITokenMetadata` concern, not the money port. USDC should never hit a meta read (decimals is constant).
- **Pros:** Removes ~40% of initiate RPC; keeps the money port to authoritative ops; no live dependency for display data.
- **Cons:** Config carries per-token decimals/symbol (small maintenance); if a live source is needed later (M04 registry) it becomes a separate memoized service.
- **Effort:** Medium
- **Risk:** Low

### Option B: Memoize in place (keep on port) with an unbounded-safe process cache
- **Description:** Cache `readTokenMeta` results by tokenContract; still on the port.
- **Pros:** Smallest change; removes repeat RPC.
- **Cons:** Leaves the layering concern (display method on money port).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — config-drive the metadata and drop `readTokenMeta` entirely (confirmed with the owner).

## Implemented Solution
Replaced the per-initiate on-chain `decimals()`/`symbol()` reads with static config. The env var
`RELAYER_FRACTION_TOKEN_ADDRESSES` became `RELAYER_FRACTION_TOKENS` — comma-separated
`address:symbol:decimals` triples (StrKeys are base32, so `:` is a safe delimiter); `relayerConfig`
parses them into `fractionTokens: { address, symbol, decimals }[]`. The export service builds the item
display metadata from this config (USDC stays a constant: `USDC_DECIMALS` + `'USDC'`), so an initiate no
longer issues the `2N` metadata simulations (~40% of the prior initiate RPC), and USDC never triggers a
meta read. `readTokenMeta` + `TokenMeta` + the `simulateRead` helper were removed from the
`RELAYER_SERVICE` port, `SorobanRelayerService`, and `FakeRelayerService` — the fail-closed money port no
longer carries a never-throws display method (`readWalletHoldings` correctly stays, being
authority-adjacent + fail-closed).

## Technical Details
Affected: `src/config/relayer.config.ts` (`fractionTokens`), `src/modules/relayer/relayer.service.interface.ts`
(removed `TokenMeta`/`readTokenMeta`), `.../soroban-relayer.service.ts` (removed `readTokenMeta`/`simulateRead`
+ unused imports), `.../wallet-export.service.ts` (meta from config), `test/shared/fake-relayer.ts`
(removed fake `readTokenMeta`/`setTokenMeta`), `test/e2e/wallet-export.e2e-spec.ts` (uses `RELAYER_FRACTION_TOKENS`).
Joi validation of the new var is todo [[133]].

## Acceptance Criteria
- [x] Token decimals/symbol no longer read on every initiate (now config).
- [x] USDC decimals never triggers an RPC read.
- [x] Display-metadata concern removed from the fail-closed money port.

## Work Log
- 2026-07-14: Filed from PR #25 review (performance + architecture reviewers).
- 2026-07-15: Implemented Option A (config-driven `RELAYER_FRACTION_TOKENS`, dropped `readTokenMeta`). build + lint + 305 unit + export e2e green. Marked complete. Joi validation follows in [[133]].
