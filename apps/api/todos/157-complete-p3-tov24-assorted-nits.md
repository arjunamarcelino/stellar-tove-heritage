---
status: complete
priority: p3
issue_id: 157
tags: [code-review, quality, wallets, TOV-24]
dependencies: []
---

# TOV-24 assorted P3 nits (test typing, interface re-declaration, redundant guard, Sep10 drift)

## Problem Statement
A bundle of low-priority polish items surfaced by the PR #26 review, grouped to avoid todo noise. None affect
behavior.

## Findings
1. **Loose test typing** — `test/e2e/me-wallets.e2e-spec.ts`: `let server: object` + `getHttpServer() as
   object` discards the real `http.Server` type; `test/unit/modules/wallets/me-wallets.service.spec.ts`: the
   constructor uses `sep10 as never` / `wallets as never`, defeating type-checking on the mocks (drift won't
   be flagged). Prefer `http.Server` / `Partial<Pick<Sep10Service, …>>` casts.
2. **Redundant interface re-declaration** — `wallet-repository.interface.ts` re-declares `softRemove`, which
   is already on `IBaseRepository` and inherited (no impl added). Inconsistent with how other base methods
   are left to the base interface. Drop the signature (keep the doc as a call-site comment) or leave as a
   deliberate doc anchor.
3. **Redundant `?? null`** — `sep10.service.ts`: `(challenge.userId ?? null) !== null` /
   `!== userId`; `challenge.userId` is already typed `string | null`. The `?? null` guards a `undefined` the
   type says can't occur (it exists only to tolerate test fakes). Either drop it or add a one-word comment on
   why the extra guard exists.
4. **Sep10Service dual-purpose drift watch** — `sep10.service.ts` now hosts `verifyBindChallenge` +
   user-stamped `buildChallenge` whose only callers live in the wallets module. Acceptable reuse (beats
   duplicating audited crypto), but if more wallet-specific challenge verbs accrue, consider a
   `Sep10BindVerifier` façade so login vs bind entry points stay self-documenting. Watch-only.

## Proposed Solutions

### Option A: Address 1–3 (small, safe) now; leave 4 as a watch note
- **Pros:** Tightens test types + removes minor inconsistencies; no behavior risk.
- **Cons:** None material.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Fix nits 1 & 3; keep 2 (reviewer premise incorrect) and 4 (watch-only).

## Implemented Solution
1. **Test typing.** `me-wallets.e2e-spec.ts`: `server` typed `import('node:http').Server` (was `object`);
   `me-wallets.service.spec.ts`: constructor casts `as never` → `as unknown as Sep10Service /
   WalletsService / IdempotencyStore` (type-only imports), documenting the intended shapes.
2. **`softRemove` re-declaration — KEPT (reviewer premise incorrect).** `IWalletRepository` does **not**
   extend `IBaseRepository` (every method is declared explicitly), so dropping the `softRemove` signature
   would break `WalletsService.removeWallet`'s compile-time call. Left in place; this is the module's
   established convention, not redundancy.
3. **`?? null`.** Added a one-line comment on the `sep10.service.ts` normalization explaining it defends an
   unhydrated `undefined` against the NULL-defaulting column.
4. **Sep10 dual-purpose façade** — watch-only, no action (documented in [[149]]/the review notes).

Build/lint clean; me-wallets unit (11) + e2e (9) green.

## Technical Details
Affected: `test/e2e/me-wallets.e2e-spec.ts`, `test/unit/modules/wallets/me-wallets.service.spec.ts`,
`src/modules/auth/sep10.service.ts`. `wallet-repository.interface.ts` intentionally unchanged.

## Acceptance Criteria
- [x] Test server/mocks typed without `as object` / `as never`.
- [x] `softRemove` interface re-declaration resolved — kept, with rationale (interface doesn't extend the base).
- [x] Redundant `?? null` commented.
- [x] Sep10 dual-purpose noted for future drift (no action).

## Work Log
- 2026-07-15: Filed from PR #26 review (kieran-typescript + pattern-recognition + architecture P3 nits).
- 2026-07-15: Fixed test typing + `?? null` comment; kept `softRemove` (interface doesn't extend base — the
  re-declaration is required, not redundant).
