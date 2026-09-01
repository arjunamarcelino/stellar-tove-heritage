---
status: complete
priority: p2
issue_id: 253
tags: [code-review, config, ops, TOV-237, PR-35]
dependencies: []
---

# Silent 100%-503 endpoint when `FRACTION_RELAYER_SECRET` is unset (no boot assertion)

## Problem Statement
If the read source pubkey can't be derived, every holdings request fails at request time with a swallowed 503 rather than failing fast at boot — a partial/read-only deployment could ship a permanently-broken endpoint with no startup signal.

## Findings
Flagged by security-sentinel (P2-2, P3-3).
- `src/config/fraction-read.config.ts:21-23` — `sourcePublicKey` falls back to `''` when `FRACTION_RELAYER_SECRET` is absent.
- `src/config/validation-schema.ts:110-115` — the `FRACTION_READ_*` block has no entry asserting a source secret/pubkey resolved. (The secret IS `required()` in the shared `fraction-factory` config, so a fully-configured deploy has it — the gap is only a read-only/partial deploy.)
- Downstream: `soroban-fraction-read.service.ts:55` `new Account('', '0')` / `Address.fromString` throws per request → caught → `FractionReadUnavailableError` → 503. Not a leak; a misconfig that should fail at boot degrades to a silent all-503 endpoint. A *malformed* (non-empty) pubkey has the same effect.

## Proposed Solutions
1. Boot-time assertion (mirror the factory boot probe): on startup, assert `fractionReadConfig.sourcePublicKey` is a non-empty valid StrKey; crash-loop otherwise. Effort: Small. Risk: none.
2. Document the coupling explicitly (read path always ships with the factory config, which `require()`s the secret) and rely on that. Effort: trivial; weaker (doesn't catch a malformed key).

## Recommended Action
**RESOLVED — Solution 1.** `fraction-read.config.ts` now derives the source pubkey via `deriveReadSourcePublicKey()`, which throws at config-load (→ app boot) if `FRACTION_RELAYER_SECRET` is absent or the derived key fails `StrKey.isValidEd25519PublicKey`. A misconfigured/partial deploy now crash-loops at boot instead of serving a silent 100%-503 endpoint.

## Technical Details
- `src/config/fraction-read.config.ts` — added `deriveReadSourcePublicKey()`; `sourcePublicKey` calls it. Verified the e2e boot (AppModule loads the config with a valid test secret) does not throw.

## Acceptance Criteria
- [x] A missing/malformed read source pubkey fails fast at boot (config-load throw).
- [x] Valid deploy unaffected (e2e boot green).

## Work Log
- 2026-07-18: created from PR #35 review (security-sentinel P2-2/P3-3).
- 2026-07-18: RESOLVED — config-factory boot assertion added; build + holdings e2e green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
