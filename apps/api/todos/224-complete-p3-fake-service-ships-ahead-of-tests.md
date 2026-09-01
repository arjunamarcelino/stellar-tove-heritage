---
status: complete
priority: p3
issue_id: 224
tags: [code-review, testing, yagni, TOV-233, PR-32]
dependencies: []
---

# FractionToken test double + its exported helper ship ahead of their only consumer (integration/e2e not wired)

## Problem Statement
The PR lands a `FakeFractionFactoryService` test double and a test-only convenience export
(`deriveFractionTokenAddress`) on the production Soroban module, but no test suite actually consumes
either yet. The module docstring claims tests override the port with the fake, which is currently
untrue. This is dead-on-arrival scaffolding unless the suites that consume it land too — and it is the
direct reason the P1 ScVal encoding bug (todo 209) is uncaught: there is no on-chain-shape test.

## Findings
- **No suite overrides the port with the fake** — `src/modules/fractionalization/fake-fraction-factory.service.ts`: grepping for `FakeFractionFactory` / the `FRACTION_FACTORY_SERVICE` token across `test/` returns nothing. No integration/e2e suite wires the fake, though the module docstring says tests do.
- **`deriveFractionTokenAddress` is test-only convenience on a production module** — `src/modules/fractionalization/soroban-fraction-factory.service.ts:259-266`: the export is consumed only by the fake and its own golden-vector unit test. The production deploy path calls `deriveWalletAddress(...)` inline (`~:93`), so the export exists purely for test convenience yet lives on the production module.
- **The fake's hardcoded inputs are unasserted** — `src/modules/fractionalization/fake-fraction-factory.service.ts:16-17`: a factory address + passphrase are hardcoded and fed only into the derivation. No test asserts the fake's specific output, so any valid StrKey/passphrase (or a fixed sentinel) would work equally well.
- **Root cause for uncaught P1** — because nothing exercises the on-chain ScVal shape, the encoding bug tracked in todo 209 slips through. An integration/e2e test that consumes the fake (and a real-shape assertion) would surface it.

## Proposed Solutions
### Option A: land the consumer in (or right behind) this PR
- Add the integration + e2e specs from the plan's test matrix (they need the local `tove_test` DB) in this PR or a fast follow, wiring `FakeFractionFactoryService` as the `FRACTION_FACTORY_SERVICE` override.
- Keep the fake and the `deriveFractionTokenAddress` export only once they have a consumer; otherwise ship them together with the suites, not ahead of them.
- **Effort: Medium.**

## Recommended Action
**RESOLVED (Option A — golden-vector + written specs, per maintainer decision).** (1) Extracted the TokenInit encoder into a pure `encodeTokenInitScVal(TokenInitFields)` in `token-init.ts` (the service delegates to it) and added `test/unit/modules/fractionalization/token-init-encoding.spec.ts` — a runnable golden-vector unit test that asserts all 17 keys are `scvSymbol` AND pins the exact base64 XDR, so the todo-209 class of bug now fails CI. (2) Wired `FakeFractionFactoryService` into a new `test/e2e/fractionalization.e2e-spec.ts` (401 / missing-key 400 / sum>100 422 / 202→drain→deployed / duplicate 409 / same-key replay) and a `test/integration/modules/fractionalization/fraction-contract.repository.integration.spec.ts` (partial-unique-excluding-failed, retry-after-failed, deployed-not-soft-deletable CHECK, casDeployed + findLatest incl. failed). The e2e/integration specs need the local `tove_test` DB + Redis (`yarn db:test:setup` first) and are UNRUN in this session — run `yarn test:integration` / `yarn test:e2e` to complete the on-chain-shape coverage; the golden-vector runs in the normal unit suite (464 pass).

## Technical Details
- `src/modules/fractionalization/fake-fraction-factory.service.ts` (whole file, esp. `:16-17`)
- `src/modules/fractionalization/soroban-fraction-factory.service.ts:259-266` (`deriveFractionTokenAddress` export), `:93` (production `deriveWalletAddress` call)
- Consumers expected under `test/integration/` and `test/e2e/` (currently absent).

## Acceptance Criteria
- [ ] Either the integration + e2e suites that consume `FakeFractionFactoryService` land, or the fake + its export ship with their consumer (not before).
- [ ] `deriveFractionTokenAddress` has at least one non-test consumer, or is documented as a test-only export.
- [ ] An on-chain-shape assertion exists that would have caught the todo-209 ScVal encoding bug.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — golden-vector unit test (runnable, 464 pass) + e2e + integration specs (need local DB to run).
