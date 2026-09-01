---
status: complete
priority: p3
issue_id: 426
tags: [code-review, tov-32, pr-55, simplicity, quality]
dependencies: []
---
# Trustline feature simplicity / YAGNI nits (bundled P3s)

## Resolution (2026-08-27)
**Applied (user-confirmed):**
- **(4) Removed the `USDC_ASSET_CODE` knob** — the code never varies. Dropped from `wallet-trustline.config.ts`
  (`usdcAssetCode` field), `validation-schema.ts` (Joi line), and `.env.example`; the adapter now uses a module
  const `USDC_ASSET_CODE = 'USDC'`. Updated the adapter-spec cfg literal accordingly.
- **(5) Removed the dead `WalletTrustlineConfig` type export** (`config.ts`) — zero importers (grep-verified); the
  service injects `ConfigType<typeof walletTrustlineConfig>` directly.
- **(3) Collapsed `fromInstruction`'s field-by-field asset copy** to `dto.asset = instruction.asset`
  (`trustline-required.dto.ts`) — `TrustlineAsset` is structurally the DTO's asset shape; not a secret-projection path.

**Consciously declined (user-confirmed / reviewer-recommended keep):**
- **(1) `asset` field + `TrustlineAssetDto` — KEPT.** It's in the published TOV-47 FE contract (display/rebuild
  convenience). Only the redundant copy (item 3) was collapsed.
- **(2) `TrustlineAsset` interface — KEPT.** A named type for `TrustlineInstruction.asset` reads clearer than an
  inline literal; trivial either way.
- **(6) `WALLET_TRUSTLINE_RPC_URL` / `_NETWORK_PASSPHRASE` overrides — KEPT.** Mirrors the `fraction-read.config`
  fallback precedent (reviewer recommended leaving them); the fail-fast guards make the split safe.

Build 0 issues; lint clean; wallet unit 69 green.

## Problem Statement
A cluster of low-value, non-blocking simplification opportunities surfaced across the PR #55 review. None are bugs;
each is a small removable surface. The core adapter + service are appropriately minimal — these are the only
arguably-over-built bits, and all are cheap.

## Findings
1. **The 3-layer `asset` plumbing + its "rebuild-it-yourself" rationale is speculative.** `TrustlineAsset`
   (interface `wallet-trustline.service.interface.ts:3-11`) → `TrustlineAssetDto` (`trustline-required.dto.ts:5-8`) →
   the field-by-field copy in `fromInstruction` (`:19-27`). The DTO comment justifies `asset` as *"provided so the FE
   can rebuild the tx itself if it prefers"* — but the whole design premise is that the FE signs the emitted seq=0
   template **as-is**; if the FE rebuilds, the server template is pointless. The only non-speculative use is
   displaying "USDC", which doesn't require echoing the issuer the FE can read from the XDR. (simplicity P3)
   → If kept, keep it purely as a display convenience; don't rely on the "rebuild" story.
2. **`TrustlineAsset` interface is referenced once** (as `TrustlineInstruction.asset`'s type). Could be inline
   `asset: { code: string; issuer: string }`. (simplicity P3)
3. **`fromInstruction` field-copy is redundant** — `trustline-required.dto.ts:19-27`. `TrustlineAsset` and
   `TrustlineAssetDto` are structurally identical and this isn't projecting away secret columns (unlike the artworks
   "never spread the record" precedent), so `dto.asset = instruction.asset` would do. (simplicity P3)
4. **`USDC_ASSET_CODE` knob is speculative** — `wallet-trustline.config.ts:37`, `validation-schema.ts` (pattern +
   max-12). The issuer legitimately varies (testnet/mainnet) and must be a knob; the *code* is always `"USDC"` for
   this feature. A configurable code with its own Joi charset validates something that never changes. (simplicity P3)
5. **`WalletTrustlineConfig` type export is dead** — `wallet-trustline.config.ts:44`. Zero importers; the service
   annotates inline with `ConfigType<typeof walletTrustlineConfig>`. Matches the every-config convention, so
   acceptable — but currently unused. Either drop it or use it in the constructor. (kieran P3, simplicity P3)
6. **Dedicated `WALLET_TRUSTLINE_RPC_URL` / `_NETWORK_PASSPHRASE` overrides almost always fall back to `RELAYER_*`**
   — `config.ts:23-33`. The read runs on the relayer's network by definition, so the split has no current use (two
   env vars + two fail-fast branches). Mirrors the `fraction-read.config` precedent, so consistent — flagged only as
   speculative surface. (simplicity P3)

## Proposed Solutions
### Option A — Trim the two lowest-value items (Recommended if touching)
Drop the `USDC_ASSET_CODE` knob (hardcode `'USDC'`) and the dead `WalletTrustlineConfig` export; collapse
`fromInstruction`'s asset copy to `dto.asset = instruction.asset`. Leave `asset`/`TrustlineAssetDto` (it's in the
published FE contract) and the RPC/passphrase overrides (mirror precedent). Effort: Small · Risk: Low.
### Option B — Ship as-is
Everything here is cheap and consistent with codebase conventions; none is a correctness or maintenance liability.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/wallets/wallet-trustline.service.interface.ts`, `src/modules/wallets/me/dto/trustline-required.dto.ts`,
  `src/config/wallet-trustline.config.ts`, `src/config/validation-schema.ts`.
- Note: `asset` is referenced in the FE contract doc — coordinate with TOV-47 before removing it.

## Acceptance Criteria
- [ ] Each nit is applied or consciously declined with a reason.

## Work Log
- 2026-08-27: Filed from PR #55 review (code-simplicity-reviewer + kieran-typescript + architecture P3s).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/55
- FE contract: docs/api-contracts/2026-08-27-tov32-byow-trustline-instruction-contract.md
