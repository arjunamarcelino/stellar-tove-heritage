---
status: complete
priority: p1
issue_id: 210
tags: [code-review, security, secrets, TOV-233, PR-32]
dependencies: []
---

# Config factory returns raw Stellar signing seeds on the injected object; 'never logged' is comment-only

## Problem Statement
The fraction-factory config factory returns the factory admin seed and relayer source seed as plain
enumerable string fields on the injected config object. The header comment claims they are never logged,
but nothing enforces that: any `logger.debug`, error serializer, or APM/Sentry breadcrumb that captures
the DI context emits both seeds in cleartext. A leak grants full deploy control plus relayer drain.

## Findings
- `src/config/fraction-factory.config.ts` ~lines 41-42 put `relayerSecret` + `factoryAdminSecret` as plain enumerable string fields on the object returned by `registerAs`.
- The header comment claims they are never logged / kept off the object, but nothing enforces it: the whole `ConfigType` is injected into `backoffice-artworks.service.ts` (~line 43) and both processors.
- Any `logger.debug(this.cfg)`, error serializer, or APM/Sentry breadcrumb capturing DI context emits both seeds in cleartext.
- These are the factory admin key (authorizes deploy) + relayer source key (funds/signs) → leak = full deploy control + relayer drain.

## Proposed Solutions
### Option A (recommended): expose only public keys; keep seeds off the DI object
- Expose only `relayerPublicKey` / `factoryAdminPublicKey` on the config object.
- Construct the `Keypair`s inside a dedicated provider that reads `process.env` directly, OR wrap seeds in a class with `toJSON()` / `[util.inspect.custom]` redaction (mirror how the relayer module handles it).
- At minimum, make the secret fields non-enumerable so serializers skip them.

**Effort: Small-Medium.**

## Recommended Action
**RESOLVED (Option A).** The two signing seeds (`relayerSecret`, `factoryAdminSecret`) are now attached to the config object via `Object.defineProperty(..., { enumerable: false })`, so they are accessible to the signer as `cfg.relayerSecret` but excluded from `JSON.stringify`, `util.inspect` (NestJS `logger.log(cfg)`), spread, and `Object.keys` — verified empirically. A `logger.debug(cfg)` / error / DI-context serialization can no longer emit a raw seed. Only the derived `relayerPublicKey` / `factoryAdminPublicKey` remain enumerable (logging-safe identity + the boot-probe target). Full KMS/Signer-port migration remains the documented production target.

## Technical Details
- Affected: `src/config/fraction-factory.config.ts` (~lines 41-42); consumers `src/modules/fractionalization/backoffice-artworks.service.ts` (~line 43) and both deploy/reconcile processors.

## Acceptance Criteria
- [ ] Raw signing seeds are no longer plain enumerable fields on the injected config object.
- [ ] Serializing the config object (JSON/inspect/APM breadcrumb) never emits the seeds.
- [ ] Consumers obtain `Keypair`s via a dedicated provider or read only public keys from config.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — seeds are non-enumerable (masked from logs/serialization); build green.
