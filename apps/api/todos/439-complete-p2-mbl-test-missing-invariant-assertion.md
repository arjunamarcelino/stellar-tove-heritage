---
status: complete
priority: p2
issue_id: 439
tags: [code-review, tov-243, pr-57, test-quality, encoding, money-path]
dependencies: []
---
# M/B/L encoder test asserts the guard throws but not the load-bearing `Address.fromString` invariant

## Resolution (2026-08-27) — Option 1: split the table + pin the invariant
**Applied** in `test/unit/modules/kyc-allowlist/kyc-allowlist-encoding.spec.ts`: the M/B/L cases now live in
their own `it.each` that asserts BOTH `expect(() => Address.fromString(bad)).not.toThrow()` (the invariant:
SDK v15 accepts them) AND `expect(() => walletToScVal(bad)).toThrow(...)` (the guard is the sole stop). The
shape/checksum negatives (which `Address.fromString` also rejects) stay in a separate table with a clearer
title. If a future SDK made `fromString` reject M/B/L, or a literal were malformed, the invariant test now
fails loudly instead of passing silently. Encoder spec 11/11 green.

## Problem Statement
The entire rationale for the explicit-allowlist guard in `walletToScVal`
(`isValidContract || isValidEd25519PublicKey`, never "construct `Address` and catch") is that in
stellar-sdk v15 `Address.fromString` **accepts** muxed `M…`, claimable-balance `B…`, and liquidity-pool
`L…` StrKeys (Protocol 23 / CAP-67) — so the guard is the *sole* stop for those. The encoder spec's inline
comment even asserts this ("accepted by fromString, rejected by both predicates").

But the test only asserts `walletToScVal` **throws** for M/B/L. It never asserts that
`Address.fromString(M/B/L)` would have *accepted* them. So the load-bearing invariant is unprotected: if a
future SDK made `fromString` reject M/B/L (guard becomes a redundant backstop, the real stop moves), or if
one of the hand-written B/L StrKey literals is malformed for an unrelated reason, the test stays green and
nobody notices the invariant eroded. The `it.each` table also conflates two distinct rejection reasons —
M/B/L (fromString *accepts*) sit alongside too-short/empty/lowercase/checksum-invalid (fromString
*rejects*) — so a single blanket assertion can't distinguish them.

## Findings
- `test/unit/modules/kyc-allowlist/kyc-allowlist-encoding.spec.ts` — the widened `it.each`
  ("rejects a StrKey that is neither a valid account (G…) nor contract (C…)"): asserts only
  `expect(() => walletToScVal(bad)).toThrow(KycAllowlistBadAddressError)`.
- The three "fromString-accepts-but-guard-rejects" cases (M/B/L) share a table with cases where fromString
  *also* rejects, preventing a targeted `Address.fromString(bad)` assertion on the whole table.

## Proposed Solutions
1. **Split the table + pin the invariant (recommended, Small).** Put M/B/L in their own `it.each` block
   that asserts BOTH `expect(() => Address.fromString(bad)).not.toThrow()` (the invariant: SDK accepts them)
   AND `expect(() => walletToScVal(bad)).toThrow(...)` (the guard is the stop). Keep the shape/checksum
   negatives in the existing table. Pros: the test now fails loudly if the SDK's behavior shifts or a
   literal is malformed. Cons: a few extra lines.
2. **Add a single guarding assertion (Small).** Keep one combined table but add a separate
   `it('confirms Address.fromString accepts M/B/L so the guard is the sole stop')` test. Pros: minimal.
   Cons: the two facts (fromString-accepts, guard-rejects) live in separate tests, weaker coupling.

## Recommended Action
_(triage — option 1)_

## Technical Details
- File: `test/unit/modules/kyc-allowlist/kyc-allowlist-encoding.spec.ts`.
- M/B/L literals were generated + verified against the installed SDK during implementation:
  `M = MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA`,
  `B = BADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOB7GHU`,
  `L = LADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQPEA4`.

## Acceptance Criteria
- [ ] The spec asserts `Address.fromString` accepts each of M/B/L (invariant) AND `walletToScVal` throws.
- [ ] Encoder unit spec stays green.

## Work Log
- 2026-08-27: Raised by kieran-typescript-reviewer (P2) in the PR #57 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
- `src/modules/kyc-allowlist/kyc-allowlist-encoding.ts` (the guard + the "never construct-and-catch" note)
