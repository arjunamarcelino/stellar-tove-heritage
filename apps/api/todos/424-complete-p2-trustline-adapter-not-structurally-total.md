---
status: complete
priority: p2
issue_id: 424
tags: [code-review, tov-32, pr-55, reliability, robustness, soroban, idempotency]
dependencies: []
---
# Trustline adapter's "TOTAL / never throws" contract is not structurally enforced

## Resolution (2026-08-27)
**Applied — Option A (front-guard, chosen over B/C).** `resolveUsdcTrustline`
(`soroban-wallet-trustline.service.ts`) now front-guards `StrKey.isValidEd25519PublicKey(publicKey)` → returns
`null` for a degenerate key (nothing meaningful to build), and the single `buildInstruction` call moved to a
**fall-through after the try/catch** (reached on absent / unauthorized / read-failure). With the key validated up
front and `asset` derived from boot-validated config, neither `Keypair.fromPublicKey` nor `new Account(pk,'-1')`
can throw — so the method is now **structurally total**, not merely total-by-invariant. The catch no longer builds
(so no catch-branch re-throw hazard) and no longer re-throws. Regression test added
(`soroban-wallet-trustline.service.spec.ts`): a malformed key returns `null` without throwing and without calling
`getLedgerEntries`. Also folded in the 427#1 log hygiene here since the catch was rewritten: the warn is now clean
and the raw RPC error moved to `debug`.
Build 0 issues; lint clean; adapter unit 5/5 green.

## Problem Statement
`IWalletTrustlineService.resolveUsdcTrustline` is documented as **TOTAL — never throws** (interface JSDoc
`wallet-trustline.service.interface.ts:28-33`). This is *load-bearing*: the resolve runs AFTER
`idempotency.complete()` and OUTSIDE the `fail()`-guarded try in `me-wallets.service.ts:99-104`, so a throw
cannot corrupt idempotency (integrity is safe) — but it CAN strand an already-bound, already-completed wallet
behind a **perpetual 500**: every idempotent replay re-runs `buildAddResponse` → throws again → the client can
never retrieve its 201 or its trustline instruction. The adapter is only *effectively* total today, by upstream
invariant, not by structure.

**Convergent finding — flagged independently by 4 reviewers:** security-sentinel, architecture-strategist,
data-integrity-guardian, kieran-typescript-reviewer. All rated it P3-because-currently-unreachable; filed here as
P2 because it undermines a documented load-bearing invariant and the fix is a ~2-line structural hardening.

## Findings
1. **`new Asset(cfg.usdcAssetCode, cfg.usdcAssetIssuer)` is OUTSIDE the try** —
   `soroban-wallet-trustline.service.ts:47` (the `try` opens at :48). `new Asset` validates its args and throws
   on a bad code/issuer. Unreachable per-request because both are boot-validated (`StrKey.isValidEd25519PublicKey`
   on the issuer, `config.ts:18`; Joi `^[A-Za-z0-9]+$`/max-12 on the code) → a bad value crash-loops at boot.
2. **The fail-open `catch` calls `buildInstruction` unguarded** — `soroban-wallet-trustline.service.ts:73-75` →
   `new Account(publicKey, '-1')` at `:84` re-validates the key. If the `try` threw *because*
   `Keypair.fromPublicKey(publicKey)` (`:49`) rejected a malformed StrKey, the catch-branch re-throw **escapes the
   method**. Unreachable today: `wallet.publicKey` is always a SEP-10-validated G-address, and the caller gates on
   `wallet.kind === 'byow' && wallet.publicKey` (truthiness only — NOT StrKey validity).
3. **The gate checks truthiness, not validity** — `me-wallets.service.ts:200-206`. Any FUTURE path that persists a
   `byow` wallet with an unvalidated `publicKey` (e.g. an admin import/backfill) would silently break the "total"
   contract and strand that wallet, with no test/type to catch it.

## Proposed Solutions
### Option A — Front-guard the public key (Recommended)
In the adapter (or the `buildAddResponse` gate), short-circuit on an invalid key:
`if (!StrKey.isValidEd25519PublicKey(publicKey)) return <null-or-skip>;` before any `Keypair`/`Account`/`Asset`
construction. There's nothing meaningful to build for a bad key anyway. Makes totality self-enforcing.
Effort: Small · Risk: Low.
### Option B — Wrap the ENTIRE adapter body (incl. line 47) in the fail-open try
Move `new Asset(...)` inside the try and guard the catch-branch `buildInstruction` so a construction throw can't
escape. Preserves the "always emit a best-effort template" behavior even for a degenerate key.
Effort: Small · Risk: Low (must ensure the catch itself cannot throw).
### Option C — Qualify the JSDoc contract instead of the code
Change "never throws (not even on RPC failure)" to "never throws for a valid ed25519 public key" and accept the
precondition. Cheapest, but leaves the invariant resting on an un-enforced precondition.
Effort: Trivial · Risk: keeps the latent strand hazard for future callers.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/wallets/soroban-wallet-trustline.service.ts` (:47, :49, :73-84),
  `src/modules/wallets/me/me-wallets.service.ts` (:99-104, :200-206),
  `src/modules/wallets/wallet-trustline.service.interface.ts` (:28-33).
- Currently UNREACHABLE — no runtime bug today; this is defense-in-depth for a documented invariant.

## Acceptance Criteria
- [ ] `resolveUsdcTrustline` cannot throw for ANY string `publicKey` (including malformed), OR the gate rejects an
      invalid key before the port is called.
- [ ] The interface JSDoc's "never throws" claim is either structurally true or explicitly qualified.
- [ ] A unit test exercises the malformed-key path (asserts no throw / graceful skip).

## Work Log
- 2026-08-27: Filed from PR #55 multi-agent code review — convergent across security / architecture /
  data-integrity / kieran-typescript (all P3-unreachable; elevated to P2 for the load-bearing invariant).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/55
- Plan: docs/plans/2026-08-27-feat-byow-usdc-trustline-instruction-plan.md
