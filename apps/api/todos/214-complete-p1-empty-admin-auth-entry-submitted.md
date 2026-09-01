---
status: complete
priority: p1
issue_id: 214
tags: [code-review, security, soroban, correctness, TOV-233, PR-32]
dependencies: []
---

# If simulation returns no matching admin auth entry, the tx is still signed + submitted (unauthorized, fee-spending, guaranteed revert)

## Problem Statement
`signAdminEntry` only overwrites `invoke.auth` when at least one signed entry exists and never asserts
that an admin entry was actually found and signed. If simulation returns no matching admin entry (empty
auth, renamed/missing entry, or wrong-admin config), the code still proceeds to sign with the relayer
and submit — broadcasting an unauthorized transaction that pays fees and then fails on-chain, instead of
a clean pre-flight rejection.

## Findings
- `src/modules/fractionalization/soroban-fraction-factory.service.ts` ~lines 144-153 + 178-187: `signAdminEntry` correctly signs only the admin address-credential entry and skips source-account creds; the `validUntil` bound is correct.
- BUT ~line 150 only overwrites `invoke.auth` when `signedAuth.length > 0`, and there's no assertion that an admin entry was actually found+signed.
- If `sim.result.auth` is empty, or the required admin entry is renamed/missing so nothing matches `this.admin.publicKey()`, the code still proceeds to `prepared.sign(this.relayer)` + `sendTransaction` → a tx with no/invalid admin authorization is broadcast, pays fees, then fails on-chain.
- A contract-shape change or wrong-admin config silently falls through to a fee-spending guaranteed-fail tx instead of a clean pre-flight rejection.

## Proposed Solutions
### Option A (recommended): assert an admin entry was signed before sign/send
- Track a `signedCount` inside `signAdminEntry`; after the map, if the factory mandates admin auth and zero entries were admin-signed, throw BEFORE `sign`/`send`.
- Optionally validate the signed entry's invocation target == factory address.

**Effort: Small.**

## Recommended Action
**RESOLVED (Option A).** `signAdminEntry` now returns `{ entry, signed }`; `buildAdminSignAndSubmit` counts the admin-signed entries and, unless the admin IS the tx source account (source-account credentials cover `require_auth`, so `adminSigned === 0` is legitimate there), throws BEFORE `sign`/`send` when zero admin entries were signed. This fails closed on an empty `sim.result.auth`, a renamed/missing admin entry, or a wrong-admin config instead of broadcasting an unauthorized, fee-spending, guaranteed-to-revert tx. The thrown Error is a terminal (non-retryable) failure — correct for a config/contract mismatch.

## Technical Details
- Affected: `src/modules/fractionalization/soroban-fraction-factory.service.ts` (`signAdminEntry` + submit path, ~lines 144-153, 178-187).

## Acceptance Criteria
- [ ] When simulation returns zero admin-matching auth entries, the code throws before signing/submitting.
- [ ] No transaction lacking valid admin authorization is ever broadcast (no fee-spending guaranteed-fail tx).
- [ ] Optionally, the signed admin entry's invocation target is validated against the factory address.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — assert an admin auth entry was signed (or admin==source) before send; build green.
