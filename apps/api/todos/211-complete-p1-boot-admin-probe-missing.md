---
status: complete
priority: p1
issue_id: 211
tags: [code-review, security, config, TOV-233, PR-32]
dependencies: []
---

# Documented boot admin/relayer probe does not exist; misconfig burns fees + strands deploys; two config pubkey fields are dead

## Problem Statement
The config file documents a boot probe that asserts the on-chain factory admin equals the configured
admin pubkey, but no such probe exists anywhere in the codebase. Without fail-fast, an admin-key
misconfiguration (wrong key/network/rotated) is only discovered after each deploy job spends relayer
fees and exhausts BullMQ attempts, then reverts the artwork. Two config pubkey fields are also dead.

## Findings
- `src/config/fraction-factory.config.ts` ~line 12 + ~line 43 comments claim "the boot probe asserts `factory.admin()` == its pubkey" and "Derived pubkeys for the boot probe", but grep shows NO such probe anywhere.
- `SorobanFractionFactoryService` has no `onModuleInit`/`onApplicationBootstrap`; the only `onModuleInit` present is the reconcile scheduler.
- Consequence: if `FRACTION_FACTORY_ADMIN_SECRET` doesn't match the on-chain factory admin (wrong key/network/rotated), there is no fail-fast — every deploy job runs simulate→sign→send, fails `admin.require_auth()` on-chain, `latchFailed` marks terminal + reverts artwork, after spending relayer fees + 5 BullMQ attempts.
- `relayerPublicKey` / `factoryAdminPublicKey` config fields (~lines 43-47) are read nowhere → dead.

## Proposed Solutions
### Option A (recommended): implement the boot probe
- Implement the probe in `onApplicationBootstrap` — simulate `factory.admin()`, assert `=== adminKeypair.publicKey()`.
- Also assert the relayer account EXISTS/funded (see todo 212).
- Crash-loop on mismatch so misconfig fails fast before any job runs.

**Effort: Small-Medium.**

### Option B: delete the misleading documentation
- If deferring the probe, delete the two misleading comments + the two dead pubkey fields so operators aren't falsely assured a probe exists.

## Recommended Action
**RESOLVED (Option A — hard-fail, config-gated).** Implemented `onApplicationBootstrap` on `SorobanFractionFactoryService`: when `FRACTION_BOOT_PROBE` is on (default true; forced `false` in the e2e vitest env + disablable for offline dev), it (1) asserts the relayer source account exists/funded via `getAccount` and (2) reads the on-chain `factory.admin()` (simulate-only) and asserts it equals `adminKeypair.publicKey()`, crash-looping with a clear message on either failure. This catches wrong-key/wrong-network/rotated-admin and unfunded-relayer misconfigs at boot instead of per-deploy fee loss + stuck fractionalizations. The `relayerPublicKey`/`factoryAdminPublicKey` config fields are now live (the probe/logging identity), so they are no longer dead. Added `FRACTION_BOOT_PROBE` to the Joi schema + `.env.example`; e2e disables it (the factory port is faked there).

## Technical Details
- Affected: `src/config/fraction-factory.config.ts` (~lines 12, 43-47); `src/modules/fractionalization/soroban-fraction-factory.service.ts`.

## Acceptance Criteria
- [ ] Either a boot probe exists that asserts `factory.admin() === adminKeypair.publicKey()` and crash-loops on mismatch, OR the misleading probe comments are removed.
- [ ] If the probe is implemented, it also asserts the relayer account exists/funded.
- [ ] The dead `relayerPublicKey` / `factoryAdminPublicKey` fields are either wired into the probe or deleted.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — boot probe implemented (hard-fail, gated); build green.
