---
status: complete
priority: p3
issue_id: 154
tags: [code-review, api, quality, TOV-24]
dependencies: []
---

# `IDEMPOTENCY_KEY_CONFLICT` overloads one error code across 409 and 422

## Problem Statement
`MeWalletsService.add` maps `in_flight → 409` and `mismatch → 422` to the **same** `errorCode`
(`IDEMPOTENCY_KEY_CONFLICT`). Elsewhere the codebase keeps a 1:1 errorCode↔semantic mapping
(`WALLET_IS_PRIMARY` 409 vs `WALLET_KIND_NOT_SUPPORTED` 422). A client branching on `errorCode` alone can't
distinguish "retry shortly (in-flight)" from "you reused the key with a different body."

## Findings
- `src/common/enums/error-code.enum.ts` — `IDEMPOTENCY_KEY_CONFLICT` (comment acknowledges the overload).
- `src/modules/wallets/export/me-wallets.service.ts` — `add()` maps both outcomes to it.
- pattern-recognition reviewer (P3).

## Proposed Solutions

### Option A: Split into `IDEMPOTENCY_KEY_IN_FLIGHT` (409) and `IDEMPOTENCY_KEY_MISMATCH` (422) (recommended)
- **Pros:** Restores the codebase's one-code-per-condition convention; clients can act on the distinction.
- **Cons:** Two new enum values; update the e2e assertions.
- **Effort:** Small · **Risk:** Low

### Option B: Keep one code (status code already distinguishes 409 vs 422)
- **Pros:** Fewer codes; the HTTP status carries the distinction.
- **Cons:** Diverges from the 1:1 convention; clients keying on `errorCode` can't tell them apart.
- **Effort:** None · **Risk:** Low

## Recommended Action
Option A (split into two codes).

## Implemented Solution
- `error-code.enum.ts`: replaced `IDEMPOTENCY_KEY_CONFLICT` with `IDEMPOTENCY_KEY_IN_FLIGHT` (409) and
  `IDEMPOTENCY_KEY_MISMATCH` (422).
- `me-wallets.service.ts` `add()`: in-flight → `IDEMPOTENCY_KEY_IN_FLIGHT`, mismatch → `IDEMPOTENCY_KEY_MISMATCH`.
- Tests: unit assertions updated (both codes + statuses); added an e2e asserting a same-key/different-body
  reuse → `422 IDEMPOTENCY_KEY_MISMATCH`. No stale references remain.

## Technical Details
Affected: `error-code.enum.ts`, `me-wallets.service.ts`, `me-wallets.service.spec.ts`, `me-wallets.e2e-spec.ts`.

## Acceptance Criteria
- [x] In-flight and mismatch carry distinct `errorCode`s; unit + e2e tests updated.

## Work Log
- 2026-07-15: Filed from PR #26 pattern-recognition review (P3).
- 2026-07-15: Split into `IDEMPOTENCY_KEY_IN_FLIGHT` / `IDEMPOTENCY_KEY_MISMATCH`; tests updated. Green.
