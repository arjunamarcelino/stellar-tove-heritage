---
status: complete
priority: p2
issue_id: 201
tags: [code-review, testing, kyc, TOV-29, PR-31]
dependencies: []
---

# Add `removed` e2e coverage (symmetric freeze-leak) — the only acceptance-criteria state with no HTTP-level test

## Problem Statement
The TOV-29 acceptance criteria require all 5 whitelist states to be observable with correct field-gating.
The e2e `GET /me/kyc/status` block covers `not_submitted`, `pending_review`, `whitelisted`, and `frozen`
over HTTP, but **never `removed`**. `frozen` and `removed` share the same gate row
(`{ whitelistedAt: false, reason: true }`), so the DTO logic is identical — but e2e's job is to prove the
full DB-CHECK → enum → service → serialization path end-to-end per state. A `removed`-specific CHECK
mismatch or a stale-`whitelisted_at` leak on `removed` would not be caught at the HTTP layer (the
symmetric `removed` freeze-leak is asserted only in unit + integration today).

## Findings
- `test/e2e/kyc.e2e-spec.ts` — the `GET /me/kyc/status` describe block has no `removed` case (grep for "removed" in the file returns nothing). (test-quality P2.)
- `frozen` freeze-leak is e2e-tested (`kyc.e2e-spec.ts` frozen case); the symmetric `removed` one is not.

## Proposed Solutions
### Option A (recommended): one e2e case mirroring the frozen test
Seed via `dataSource.query`: `kyc_status='removed'`, `kyc_reason='removed_by_request'`, and a stale
`whitelisted_at`; assert `{ status:'removed', reason:'removed_by_request', whitelistedAt:null }`. Proves
the removed round-trip + the removed freeze-leak guard over HTTP. **Effort: Small.**

> Cross-reference [[204-pending-p3-kyc-whitelist-test-redundancy-trim]]: that todo argues against
> re-walking all 5 states at every layer. These reconcile — keep e2e to representative states
> (`not_submitted` for the key-shape contract + `frozen`/`removed` for the mutated/gated path), rather
> than all five. Add `removed`; don't necessarily also add the two currently-missing at e2e.

## Recommended Action
**RESOLVED.** Added a `removed` e2e case (seeds `kyc_status='removed'`, `kyc_reason='removed_by_request'`, and a
stale `whitelisted_at`) asserting `{ status:'removed', reason:'removed_by_request', whitelistedAt:null }` — the
symmetric leak guard over HTTP. Per the user decision (add removed + trim to representative), the redundant
`frozen` e2e case is dropped in [[204-complete-p3-kyc-whitelist-test-redundancy-trim]] so the e2e mutated-state
representatives become `whitelisted` (whitelistedAt gate) + `removed` (reason gate + leak guard).

## Technical Details
- Affected: `test/e2e/kyc.e2e-spec.ts` (`GET /me/kyc/status` describe block).

## Acceptance Criteria
- [ ] A `removed` case exists at the e2e layer asserting `reason` is surfaced and `whitelistedAt` is null even with a stale timestamp.

## Work Log
- 2026-07-17: Filed from PR #31 review (test-quality P2). No code changed.
- 2026-07-17: RESOLVED. Added removed e2e case (kyc.e2e-spec now 17 tests, e2e 132 green). Status → complete.
