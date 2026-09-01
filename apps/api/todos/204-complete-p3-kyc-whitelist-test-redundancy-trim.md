---
status: complete
priority: p3
issue_id: 204
tags: [code-review, testing, simplicity, kyc, TOV-29, PR-31]
dependencies: [201]
---

# Trim triple-redundant 5-state gating coverage across unit/integration/e2e

## Problem Statement
The same field-gating truth table (not_submitted→all null; pending→lastSubmissionAt only;
whitelisted→whitelistedAt; frozen→reason+freeze-leak; removed→reason) is asserted at all three layers.
The gating logic lives entirely in the pure `FIELD_GATE` map + `build()` (no DB, no HTTP), so the **DTO
unit spec is its correct, exhaustive home**. The integration and e2e layers should each keep one
representative gating case to prove *their* wiring (projection→build; HTTP→service→DTO), not re-walk all
five states. This is a simplicity/maintenance concern, not a correctness one.

## Findings
- Frozen freeze-leak asserted three times: `test/unit/modules/kyc/whitelist-status-response.dto.spec.ts` (frozen case), `test/integration/modules/kyc/kyc-whitelist-status.integration.spec.ts` (frozen case), `test/e2e/kyc.e2e-spec.ts` (frozen case). (simplicity P2.)
- whitelisted-surfaces-whitelistedAt and not_submitted-all-null similarly duplicated across the three layers.
- Genuinely layer-unique tests that must stay: integration soft-delete handling, status/submission decoupling, 404, and CHK-constraint parity; e2e auth/404/is_active + the JSON key-set/leak scan.

## Proposed Solutions
### Option A (recommended): representative-per-layer
- **Integration:** cut the per-state gating re-assertions down to one frozen case (exercises both the reason path and the freeze-leak gate); keep soft-delete, decoupling, 404, CHK-reject.
- **E2E:** keep `not_submitted` (key-shape/contract) + one mutated state; keep auth/404/is_active + the serialization leak scan; drop a redundant mutated-state HTTP case.
- Net ~3–4 cases removable, zero coverage loss.

**Effort: Small.** Reconcile with [[201-pending-p2-kyc-whitelist-removed-e2e-coverage]] (which *adds* a
`removed` e2e case): the reconciliation is "one representative mutated state at e2e" — make that state
`removed` if `frozen` is dropped, or keep frozen and add removed only if you want both mutated states.

## Recommended Action
**RESOLVED (representative-per-layer, per user decision).** Unit stays exhaustive (all 5 states). Trimmed:
- **Integration** (10 → 8 tests): dropped the standalone `pending_review` case (its `lastSubmissionAt` is covered
  by the decoupling + soft-delete tests) and the `removed` case (shares `frozen`'s gate row). Kept `not_submitted`,
  `whitelisted`, `frozen`, decoupling, soft-delete×2, 404, CHECK-reject.
- **E2E** (17 → 16 tests): dropped `frozen` (the `removed` case added in 201 is the symmetric representative). E2E
  mutated states are now `whitelisted` (whitelistedAt gate) + `removed` (reason gate + leak guard), plus
  `not_submitted` (contract/key-shape/no-leak) and auth/404/is_active.
Collective coverage of both gated fields at every layer is preserved; no scenario lost.

## Technical Details
- Affected: `test/integration/modules/kyc/kyc-whitelist-status.integration.spec.ts`, `test/e2e/kyc.e2e-spec.ts`.

## Acceptance Criteria
- [ ] The 5-state gating truth-table is exhaustive at the unit layer; integration + e2e keep only representative gating cases plus their layer-unique tests.

## Work Log
- 2026-07-17: Filed from PR #31 review (code-simplicity-reviewer P2). No code changed.
- 2026-07-17: RESOLVED. Integration 10→8, e2e 17→16 (reconciled with 201). build/lint/integration/e2e green. Status → complete.
