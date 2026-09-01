---
status: complete
priority: p3
issue_id: 427
tags: [code-review, tov-32, pr-55, observability, consistency, docs, quality]
dependencies: []
---
# Trustline feature observability / consistency / doc nits (bundled P3s)

## Resolution (2026-08-27)
**Applied:**
- **(1) Fail-open log no longer interpolates the raw RPC error** — landed in the #424 catch rewrite: the `warn`
  is now clean (`... failing open`) and the raw error moved to `logger.debug` (silent under prod LOG_LEVEL).
- **(2) Auth-required clarifying comment added** at the authorized-flag check (`soroban-wallet-trustline.service.ts`):
  notes the bit-check only matters for an `auth_required` issuer (Circle USDC is not — always auto-authorized), and
  that a change_trust wouldn't help a regulated deauthorized trustline anyway.
- **(4) RELAYER_* fallback JSDoc note added** (`wallet-trustline.config.ts`): states the cross-domain borrow is
  intentional (no shared "network" config; the fraction-read mirror borrows FRACTION_* the same way).

**Consciously declined (documented-as-intended, no code change):**
- **(3) Non-byte-identical idempotent replay** — deliberate (mirrors the RFQ `balanceWarning` fresh-response
  pattern) and already documented in the FE contract; nothing to change.
- **(5) classic-issuer ↔ SAC-USDC drift** — no shared source to guard against in code; `.env.example` already flags
  "set the mainnet issuer before any mainnet cutover" as the ops mitigation.
- **(6) integration test's InMemory-idempotency thinness** — the three tiers were explicitly requested; noted as the
  highest-overlap tier if ever trimming, but the DB-backed delta (persist + reload) is real. Left as-is.

Build 0 issues; lint clean.

## Problem Statement
A set of non-blocking observability, documentation, and semantic-clarity notes from the PR #55 review. None affect
correctness; each is a small clarity or defense-in-depth win, or a deliberate design point worth documenting so a
future reader doesn't misread it.

## Findings
1. **Fail-open warn log interpolates the raw RPC error string.** `soroban-wallet-trustline.service.ts:74` —
   `failing open: ${e.message}`. `publicKey` is a public G-address (fine), but the RPC error message can carry the
   RPC host / driver internals into logs. Log-only, no secret, not user-facing. (security-sentinel P3)
2. **The deauthorized-trustline branch only matters for auth-required assets — worth a comment.**
   `soroban-wallet-trustline.service.ts:65-69`. When a trustline exists but the AUTHORIZED bit is clear, the code
   emits a `change_trust` template — but for an auth-required issuer that op is a no-op (only the issuer can
   re-authorize via `set_trust_line_flags`). For Circle USDC (NOT auth-required) a present trustline is always
   auto-authorized (`flags = 1`), so this branch is effectively dead/defensive. The bit test itself is correct. Add a
   one-line comment noting the branch only matters for auth-required assets, which USDC isn't. (kieran P3)
3. **Idempotent replay is intentionally NOT byte-identical.** `me-wallets.service.ts:186-204` — `buildAddResponse`
   re-resolves on every call (stored body is only `{walletId}`), so a replayed 201 can carry a *different*
   `trustlineRequired` than the original (user trusted USDC between calls, or one call hit fail-open). This is a
   deliberate deviation from strict replay-identity, mirrors the sanctioned RFQ `balanceWarning` "fresh-response-only"
   pattern, and is documented in the FE contract — but it's a real replay-identity break worth keeping visible for
   future readers. (data-integrity P3) No action beyond ensuring the FE contract note stays.
4. **Cross-domain config fallback (`RELAYER_*`) deserves a one-line "intentional" JSDoc note.**
   `wallet-trustline.config.ts:23-33` falls back to `RELAYER_NETWORK_PASSPHRASE`/`RELAYER_RPC_URL`, whereas the mirror
   `fraction-read.config.ts` borrows same-domain `FRACTION_*`. The app has no single "network" config, so each Soroban
   domain borrows a different sibling. The fail-fast guards make it safe; a JSDoc note that the RELAYER_* borrow is
   intentional prevents future confusion. (architecture P3)
5. **No drift guard between the classic `USDC_ASSET_ISSUER` and the SAC USDC used by the money paths.**
   `wallet-trustline.config.ts:17`. The classic issuer (trustline) and the SAC contract address the relayer/offering
   paths use (`OFFERING_ESCROW_USDC_ADDRESS` etc.) are different representations with no shared source; a misconfig
   where they don't correspond to the same asset would silently establish trust for the "wrong" USDC. No shared source
   to guard against in code — this is an ops/observability note; `.env.example` already flags "set the mainnet issuer
   before any mainnet cutover," which is the mitigation. (architecture P3)
6. **Integration spec's P1-guard delta over the unit test is thin.** `me-wallets-trustline.integration.spec.ts` uses
   `InMemoryIdempotencyStore` (same as unit), so its P1/replay assertions re-prove the unit guard against a real
   DB-backed `WalletsService` but NOT against real (Redis) idempotency — the delta is only "the wallet actually
   persisted and reloads." Acceptable (the user wanted all three tiers), noted as the highest-overlap tier if ever
   trimming. (simplicity P3)

## Proposed Solutions
### Option A — Apply the two comment/doc touch-ups (Recommended)
Add the auth-required clarifying comment (item 2) and the RELAYER_* "intentional" JSDoc note (item 4). Optionally
drop the raw error string from the fail-open log (item 1) — e.g. log a generic message + the error at `debug`. Leave
items 3/5/6 as documented-as-intended. Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/wallets/soroban-wallet-trustline.service.ts` (:65-69, :74),
  `src/modules/wallets/me/me-wallets.service.ts` (:186-204), `src/config/wallet-trustline.config.ts` (:17, :23-33),
  `test/integration/modules/wallets/me-wallets-trustline.integration.spec.ts`.

## Acceptance Criteria
- [ ] Each item is applied or consciously declined with a reason.

## Work Log
- 2026-08-27: Filed from PR #55 review (security / kieran / data-integrity / architecture / simplicity P3s).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/55
- FE contract: docs/api-contracts/2026-08-27-tov32-byow-trustline-instruction-contract.md
