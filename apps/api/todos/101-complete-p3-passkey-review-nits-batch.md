---
status: complete
priority: p3
issue_id: 101
tags: [code-review, cleanup, tov-21]
dependencies: []
---

# Passkey Review Nits (Batch)

## Problem Statement
Low-value cleanups/notes from the PR #21 review, batched. None affect correctness.

## Findings
1. **Email enumeration + timing on `begin`.** 409 (taken) vs 200 (unknown) + a latency gap
   (unknown additionally runs option-gen + INSERT) lets an unauthenticated caller enumerate registered
   emails (throttle 10/min/IP). Mirrors the existing `/register` posture — likely accepted, but
   undocumented. Decide: accept + document, or return options unconditionally and defer the conflict
   to `finish`. — `src/modules/auth/passkey.service.ts:43-45` (security P3, pattern)
2. **Redundant coordinate check.** `decodeCoseToRawP256` asserts `x/y instanceof Uint8Array && len===32`,
   which is subsumed by the final `pkcs.length===65 && pkcs[0]===0x04` check. Defensible belt-and-
   suspenders on security-critical decoding; trim only if desired. Keep the `crv===P256` check (load-
   bearing — `convertCOSEtoPKCS` does not validate the curve). — `src/modules/auth/passkey.helpers.ts:39-45`
3. **Unused `signCount` param** in the test authenticator (`buildAttestation`) — no caller passes it;
   drop until the assertion/clone-detection flow needs it. — `test/shared/webauthn-authenticator.ts:44-51`
4. **down() FK-safety depends on an app invariant.** The rollback deletes passkey users by
   `password_hash IS NULL AND email IS NOT NULL`; if a user ever owns BOTH a passkey and a byow wallet
   (not reachable today — `createEmbeddedPasskeyWallet` always mints a fresh user), the delete would
   FK-violate. Add `AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = users.id)` or a comment
   pinning the invariant. — `src/database/migrations/1716000000012-AddPasskeyRegistration.ts:123-128`
5. **`UQ_wallets_public_key_active` predicate** could add `AND public_key IS NOT NULL` for symmetry
   with the contract_address index (passkey rows now sit as harmless NULL entries). Cosmetic. — migration 011 index
6. **DTO validators vs SDK unions.** `transports?` is `@IsString({ each: true })` (accepts any string
   array) and `publicKeyAlgorithm?` is unconstrained; tightening to `@IsIn([...])` would make the
   types honest. Low impact. — `src/modules/auth/dto/passkey-register-finish.dto.ts:31-40`
7. **bigint transformer `to` is an identity fn** — a `from`-only transformer reads cleaner. — `src/modules/wallets/entities/passkey-credential.entity.ts:30-34`

## Proposed Solutions
Cherry-pick during a cleanup pass. Item 1 (enumeration) and item 4 (down() comment) are the
highest-value; the rest are optional polish. Effort: Small each · Risk: Low.

## Recommended Action
Resolved 2026-07-03:
- #1 (enumeration): **accept + document** (chosen) -- consistent with `/register`; documented in `auth/CLAUDE.md`.
- #3 (unused signCount): **removed** from `buildAttestation`.
- #4 (down() FK-safety): **added** `AND NOT EXISTS (... wallets w ...)` guard + comment.
- #2 (redundant coord check): **keep** -- belt-and-suspenders on security-critical decode gives clearer error messages; the explicit `crv===P256` check is load-bearing anyway.
- #5 (UQ_wallets_public_key_active predicate): **won't-fix** -- the index lives in the already-shipped migration 011; NULL entries are harmless, not worth a new migration.
- #6 (transports @IsString): **keep** -- `AuthenticatorTransportFuture` is intentionally open ("Future"); permissive validation is correct for forward-compat.
- #7 (bigint transformer `to`): **keep** -- TypeORM's `ValueTransformer` requires both `to` and `from`.

## Acceptance Criteria
- [ ] `begin` enumeration posture decided + documented.
- [ ] Chosen nits applied or explicitly deferred.

## Work Log
- 2026-07-02: Filed from PR #21 review (simplicity, TS, data-integrity, security, pattern reviewers).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21

## Work Log
- 2026-07-03: RESOLVED. Applied #1 (doc), #3 (remove signCount), #4 (down() NOT EXISTS guard). #2/#5/#6/#7 kept with documented rationale above. Build+lint clean; passkey unit 24, integration 22, e2e 8 green.
