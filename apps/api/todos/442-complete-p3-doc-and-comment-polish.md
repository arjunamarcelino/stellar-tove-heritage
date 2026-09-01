---
status: complete
priority: p3
issue_id: 442
tags: [code-review, tov-243, pr-57, docs, comments]
dependencies: []
---
# Doc/comment polish: stale error JSDoc, 4-lockstep predicate cross-ref, migration online-safety wording

## Resolution (2026-08-27) — all three comment fixes applied
- `kyc-allowlist.errors.ts` — `KycAllowlistBadAddressError` JSDoc now says "valid Stellar account (G…) or
  Soroban contract (C…) StrKey … or a disallowed kind such as muxed/M…", matching the widened throw-site.
- `kyc-allowlist-encoding.ts` — added a comment above the guard enumerating the FOUR lockstep locations of
  the G-or-C rule (this guard, the DTO predicate, the migration 057 CHECK, the D7 account filter) and why
  they can't be merged (neutral→backoffice dependency direction), so the set is discoverable.
- `1716000000057-…ts` — reworded the header to mirror 037's honesty: under `transactionMode:'each'` the
  DROP's ACCESS EXCLUSIVE is held to COMMIT, so the whole (sub-ms) up() blocks readers/writers; the
  NOT VALID/VALIDATE split doesn't buy online-ness here — it's safe only because the tables are tiny.

Comment-only; build clean.

## Problem Statement
Three documentation-only drifts introduced or exposed by the widening. Zero functional impact; grouped
because each is a one-to-two-line comment fix.

## Findings
1. **Stale JSDoc on the encoding error class** — `src/modules/kyc-allowlist/kyc-allowlist.errors.ts:4`.
   `KycAllowlistBadAddressError`'s doc still reads "not a valid Soroban **contract** StrKey", but the error
   is now thrown for a G-or-C failure (the throw-site message at `kyc-allowlist-encoding.ts:21-22` was
   correctly updated). Update the class doc to match the widened contract.
2. **Widen predicate lives in 4 lockstep locations with no compile-time link** —
   `item.dto.ts:26` (`isValidStrKeyAddress`), `kyc-allowlist-encoding.ts:20` (inline disjunction),
   migration `057` regex `^[GC]…`, and `backoffice-kyc-allowlist.service.ts:242` (D7 `isValidEd25519PublicKey`
   filter). The module-boundary direction (neutral `kyc-allowlist` cannot import the backoffice DTO)
   *forbids* sharing the predicate, so this is architecturally necessary — but a future re-narrow/re-widen
   could update one and miss another. Add a one-line cross-reference comment in the encoder pointing at the
   DTO predicate as the canonical intent (and vice-versa) so the lockstep set is discoverable.
3. **Migration header slightly over-states online-safety** — `1716000000057-…ts:14`. The comment describes
   each statement's lock in isolation ("NOT VALID is a catalog flip, VALIDATE runs under the weaker SHARE
   UPDATE EXCLUSIVE"), but under `migrationsTransactionMode: 'each'` the whole up() is one transaction, so
   the ACCESS EXCLUSIVE taken by the preceding `DROP CONSTRAINT` is held until COMMIT — readers/writers are
   blocked for the whole (sub-ms) transaction, not just the catalog flip. Sibling `037:11-17` words this
   more honestly. Zero functional impact (tiny tables, well under the 3s `lock_timeout`); mirror 037's
   wording for accuracy.

## Proposed Solutions
1. **Fix all three comments (recommended, Small).** Pure doc edits. Pros: accuracy; makes the lockstep set
   discoverable. Cons: none.

## Recommended Action
_(triage — bundle the three comment fixes)_

## Technical Details
- Files: `src/modules/kyc-allowlist/kyc-allowlist.errors.ts`,
  `src/modules/kyc-allowlist/kyc-allowlist-encoding.ts`,
  `src/database/migrations/1716000000057-WidenKycAllowlistWalletCheckToGC.ts`.

## Acceptance Criteria
- [ ] `KycAllowlistBadAddressError` JSDoc names the G-or-C contract.
- [ ] The encoder carries a cross-reference to the DTO predicate (the lockstep set is discoverable).
- [ ] Migration 057 header reflects that the DROP's ACCESS EXCLUSIVE is held to COMMIT (mirror 037).

## Work Log
- 2026-08-27: Raised by architecture-strategist (2 P3s) + data-migration-expert (P3) in the PR #57 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
