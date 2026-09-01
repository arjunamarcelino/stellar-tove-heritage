---
status: complete
priority: p3
issue_id: 143
tags: [code-review, documentation, export, TOV-40]
dependencies: []
---

# Reconcile plan/AC vs implementation: throttle values, request field name, allowlist-oracle note

## Problem Statement
Three small doc/contract reconciliations surfaced by the review (implementation is defensible; the docs/AC lag):
1. **Throttle values:** the plan/AC pins export initiate + submit at 10/min; the implementation ships 3/10/30 (a deliberate hardening — initiate is RPC-amplifying). The 3/10/30 scheme is a new per-endpoint pattern not captured anywhere.
2. **Request field name:** the AC/brainstorm specifies the request body as `{ target_address }` (snake_case); the DTO accepts `targetAddress` (camelCase, the house convention — the plan's own response example already uses camelCase). A FE built to the literal AC would hit `VALIDATION_FAILED`.
3. **Allowlist enumeration oracle:** `RECIPIENT_NOT_WHITELISTED` vs proceeding lets an authenticated caller probe whether an arbitrary address is KYC-allowlisted (bounded by the 3/min initiate throttle). Decision should be documented (accept as low residual, or return a generic "not eligible" code for both not-allowlisted and other target-policy failures).

## Findings
- `src/modules/wallets/export/wallet-export.controller.ts:26,38,49` (3/10/30) vs plan `docs/plans/2026-07-14-...-plan.md:168,189`.
- `src/modules/wallets/export/dto/export-wallet.dto.ts:15` (`targetAddress`) vs brainstorm `:16` / plan `:172` (`target_address`).
- `wallet-export.service.ts:74` — `RECIPIENT_NOT_WHITELISTED` as a distinguishable outcome.

## Proposed Solutions

### Option A: Update the plan/brainstorm + record decisions
- **Description:** Correct the plan to `targetAddress` + capture the 3/10/30 money-surface throttle convention; record the allowlist-oracle decision (accept + rely on throttle/auth, or genericize the error). Confirm the field name with the FE (they're aligned to camelCase per the last exchange).
- **Pros:** Docs and code agree; contract unambiguous for the FE.
- **Cons:** Docs-only (no code change unless the oracle decision genericizes the error code).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Update the plan doc + record the decisions (docs-only; the oracle stays a distinct code).

## Implemented Solution
Reconciled `docs/plans/2026-07-14-feat-export-embedded-wallet-endpoint-plan.md` with what shipped:
corrected the initiate throttle example (`limit: 10` → `3`), the request-contract field
(`target_address` → `targetAddress`, noting the DB column stays snake_case), and the submit "Same
throttle" line (→ explicit 10/min); and added a "Docs reconciliation" subsection recording the 3/10/30
money-surface throttle convention, the camelCase request-field decision (confirmed with FE), and the
allowlist-oracle decision (kept distinct `RECIPIENT_NOT_WHITELISTED`, accepted as low-risk — bounded by
the 3/min initiate throttle + auth + audited). No code change (the oracle code stays distinct).

## Technical Details
Affected: `docs/plans/2026-07-14-feat-export-embedded-wallet-endpoint-plan.md` (living doc — updated, not
deleted). DB-column `target_address` references left as-is (correct snake_case columns).

## Acceptance Criteria
- [x] Plan field name matches the DTO (`targetAddress`).
- [x] The 3/10/30 throttle convention is documented.
- [x] The allowlist-oracle decision is recorded.

## Work Log
- 2026-07-14: Filed from PR #25 review (pattern + security reviewers).
- 2026-07-15: Reconciled the plan doc (throttle, field name, oracle decision). Marked complete.
