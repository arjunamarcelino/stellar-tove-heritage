---
status: complete
priority: p3
issue_id: 106
tags: [code-review, hardening, config, relayer, TOV-21]
dependencies: []
---

# Relayer config + input hardening (StrKey validation, redundant guard, key-material assert, dead config)

## Problem Statement
A cluster of low-risk hardening nits on the factory-deploy config + input boundary, surfaced by
multiple reviewers. None are attacker-reachable (operator config / upstream-validated input), but
each trades a cheap boot-time/boundary check for a clearer failure.

## Findings
1. **Address Joi validates length only, not StrKey shape** — `src/config/validation-schema.ts:52-54`.
   `RELAYER_FACTORY_ADDRESS` / `RELAYER_WEBAUTHN_VERIFIER_ADDRESS` use `.length(56)`; any 56-char
   string boots and only fails later inside `Address.fromString` (503 per deploy). Add
   `.pattern(/^C/)` (or `StrKey.isValidContract`) for boot-time fast-fail.
2. **Runtime guard covers only 1 of 3 required config fields** — `soroban-relayer.service.ts:79-81`
   throws for empty `walletWasmHash` but not `factoryAddress` / `webauthnVerifierAddress` (all three
   are Joi `.required()`). Prefer dropping the redundant guard entirely (trust Joi, matching the
   SEP-10 service) — the `?? ''` default can't survive validation. (Also delete the now-unreachable
   "unconfigured walletWasmHash" unit test, plan §167.)
3. **No length assert on the 65-byte key material** — `signer-encoding.ts:23-25`. `buildKeyData`
   trusts a 65-byte `0x04`-prefixed point (guaranteed upstream by `decodeCoseToRawP256`). A cheap
   `if (secp256r1PublicKey.length !== 65) throw` fails loud at the boundary rather than deploying a
   wallet bound to garbage on a fee-spending, unrecoverable path.
4. **`ed25519VerifierAddress` is loaded/validated but unused** — `relayer.config.ts:22`,
   `validation-schema.ts:54`. Documented "stored now, unused for MVP" for the future recovery signer
   and left `.optional()`; multiple reviewers agree it's an acceptable *documented* YAGNI carry.
   Decision only: keep (cheap, tracked to the recovery-signer work) or drop until then.

## Proposed Solutions
Apply 1–3 (small, uncontroversial); make an explicit keep/drop call on 4.
- **Effort:** Small · **Risk:** Low

## Recommended Action
**RESOLVED — did 1, 2, 3; kept 4 (confirmed with the user).**

## Resolution (2026-07-03)
1. **StrKey-shape Joi validation** — `src/config/validation-schema.ts`: added
   `STELLAR_CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/` + `STELLAR_SECRET_SEED = /^S[A-Z2-7]{55}$/` and
   switched `RELAYER_FACTORY_ADDRESS` / `RELAYER_WEBAUTHN_VERIFIER_ADDRESS` /
   `RELAYER_ED25519_VERIFIER_ADDRESS` + `RELAYER_SECRET` from `.length(56)` to `.pattern(...)`. A
   misconfigured address now fails at boot, not per-deploy inside `Address.fromString`.
2. **Dropped the redundant runtime guard** — `soroban-relayer.service.ts`: removed the
   `if (!this.cfg.walletWasmHash) throw` (Joi already `required()`s the hash + all addresses), and
   deleted the now-unreachable "unconfigured walletWasmHash" unit test. Guarding is consistent
   (Joi-only) across all required relayer fields.
3. **65-byte key-material assert** — `signer-encoding.ts`: `buildKeyData` throws unless the point is
   exactly `SECP256R1_PUBLIC_KEY_SIZE` (65) bytes, failing loud before an unrecoverable on-chain
   deploy. Added a unit test; updated the relayer spec's `input` to a real 65-byte point.
4. **`ed25519VerifierAddress` kept** with its "stored now, unused for MVP" comment (per user
   decision) — the only address left `.optional()`, tracked to the recovery-signer work.
- Verified: lint clean, `yarn build` 0 issues, unit 252, e2e 60 (Joi patterns boot on the real-shaped
  test fixtures).

## Technical Details
- Files: `src/config/validation-schema.ts`, `src/modules/relayer/soroban-relayer.service.ts`,
  `src/modules/relayer/signer-encoding.ts`, `test/unit/modules/relayer/*.spec.ts`.

## Acceptance Criteria
- [x] The three relayer addresses fail Joi at boot on a non-`C` / invalid StrKey value.
- [x] Config-presence guarding is consistent (Joi-only) across the required relayer fields.
- [x] `buildKeyData` rejects a non-65-byte public key.
- [x] `ed25519VerifierAddress` decision recorded (keep).

## Work Log
- 2026-07-03: Filed from the factory-deploy multi-agent review (kieran-typescript, security-sentinel, architecture-strategist, pattern-recognition).
- 2026-07-03: **Resolved** (items 1–3 applied, 4 kept per user) — see Resolution. Committed.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/23
