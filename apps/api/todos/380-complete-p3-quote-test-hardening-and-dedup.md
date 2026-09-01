---
status: complete
priority: p3
issue_id: 380
tags: [code-review, test-coverage, tov-175, pr-48]
dependencies: []
---
# Test hardening & de-duplication for the quote suite (PR #48)

## Problem Statement
The quote tests pass and cover the matrix, but a few unit cases can pass vacuously, and the DB seeders are
duplicated across integration and e2e.

## Findings
Source: code-simplicity-reviewer (P3-4/P3-5), reinforced by todo 370 (needs a regression test).
1. **`await run(h, …).catch((e) => { expect(...) })` can pass vacuously.** If a regression ever made `submit`
   resolve instead of throw, the `catch` body never runs and no `expect` fails → false green. Affected cases in
   `test/unit/modules/marketplace/quotes.service.spec.ts` (e.g. the free-balance, 503, state-gate, price,
   overflow, in_flight/mismatch, backstop cases). The `it.each` state-gate block is backstopped (it also asserts
   `fail`/`complete` call counts), but the standalone `.catch` cases are not. → replace with
   `await expect(run(h, …)).rejects.toThrow()` (or `.rejects.toMatchObject(...)`) plus the code/status checks.
2. **`savedRow` is returned from `build()` but never consumed** (`quotes.service.spec.ts:44-54, 113`) — drop it
   from the handle tuple.
3. **`seedArtwork`/`seedRfq` duplicated byte-for-byte** across
   `test/integration/modules/marketplace/quote.constraints.integration.spec.ts:77-95` and
   `test/e2e/marketplace-quote.e2e-spec.ts:94-112` (identical `fraction_contracts` INSERT). The repo already has
   the shared-seeder pattern (`test/shared/seed-offering.ts`) — a `test/shared/seed-rfq.ts` /
   `seedArtworkWithContract(q)` helper removes one copy and prevents drift.

## Proposed Solutions
### Option A — Harden assertions + extract a shared seeder (Recommended)
- Convert the vacuous `.catch` cases to `rejects.toThrow`/`rejects.toMatchObject`; drop `savedRow`; add a
  `test/shared/seed-rfq.ts` (mirroring `seed-offering.ts`) used by both DB suites. Add the lapsed-own-quote
  re-quote regression (todo 370) here.
- Pros: closes the false-green hole; removes ~18 lines of duplicated seed; single source of truth for seeds.
- Cons: adds one shared test file.
- Effort: Small · Risk: Low
### Option B — Harden assertions only
- Just fix the vacuous `.catch` cases; leave the duplicated seeders.
- Effort: Small · Risk: Low

## Recommended Action
Option A. The `rejects.toThrow` conversion is the important part (real coverage hole); the shared seeder is a
convention-aligned bonus.

## Resolution (2026-08-22, complete — Option A)
1. **Vacuous assertions closed**: added a `rejects(promise, assert)` helper to the unit spec that FAILS if the
   submit resolves, then converted all 12 `await run(...).catch((e) => {...})` cases to `await rejects(run(...),
   (e) => {...})`. A regression that made `submit` resolve now fails the test instead of passing green.
2. **Unused `savedRow`** dropped from the `build()` handle.
3. **Shared seeder**: new `test/shared/seed-marketplace.ts` (`seedArtworkWithContract`, `seedOpenRfq`,
   `SEED_CONTRACT_ADDR`) — the integration + e2e specs now both use it (removed the two byte-identical local
   copies + the duplicated CONTRACT_ADDR/ARTIST_ADDR/WASM consts). Mirrors the `seed-offering.ts` convention.
The lapsed-own-quote regression (todo 370) already landed in the integration + e2e specs. Build 0; eslint 0;
quote unit 26 / integration 14 / e2e 16 green.

## Technical Details
- Affected: `test/unit/modules/marketplace/quotes.service.spec.ts`, the two DB specs, new `test/shared/seed-rfq.ts`.

## Acceptance Criteria
- [x] All negative unit cases assert via a `rejects()` helper (cannot pass if `submit` resolves).
- [x] `savedRow` removed from the `build()` handle.
- [x] A shared RFQ/artwork+contract seeder (`test/shared/seed-marketplace.ts`) is used by both DB suites.
- [x] Regression test for the lapsed-own-quote re-quote path (todo 370) added (integration + e2e).

## Work Log
- 2026-08-22: Filed from PR #48 review (code-simplicity-reviewer P3-4/P3-5).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
- Related: todo 370 (lapsed-own-quote regression)
