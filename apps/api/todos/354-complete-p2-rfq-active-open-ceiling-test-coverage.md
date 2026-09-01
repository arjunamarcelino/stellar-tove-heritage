---
status: complete
priority: p2
issue_id: 354
tags: [code-review, testing, tov-172]
dependencies: []
---
# The `MAX_ACTIVE_OPEN_RFQS` ceiling gate (`RFQ_TOO_MANY_ACTIVE`) has zero rejection coverage (PR #46)

## Problem Statement
The active-open ceiling is the one business gate in `RfqsService.create` with no test asserting its rejection.
The unit `build()` harness supports an `activeOpen` override but no `it` uses it to assert the 422; the e2e
covers 403/404/422-not-fractionalized/mismatch but not the ceiling; the integration spec only checks
`countActiveOpenByCollector` returns the right number, never the service's `>= MAX_ACTIVE_OPEN_RFQS` branch.

## Findings
Source: pattern-recognition-specialist (P2).

- `src/modules/marketplace/rfqs/rfqs.service.ts:94-97` (`RFQ_TOO_MANY_ACTIVE`, 422)
- `test/unit/modules/marketplace/rfqs.service.spec.ts` (has the `activeOpen` override, unused for the reject)

## Proposed Solutions
### Option A — Add a unit test for the ceiling branch
- Description: `build({ activeOpen: 25 })` → expect 422 `RFQ_TOO_MANY_ACTIVE`; assert `idempotency.fail` called,
  `insertOpen` NOT called, `idempotency.begin` called once (proves it ran after begin). Optionally add an e2e that
  seeds 25 open RFQs for a collector and asserts the 26th is 422.
- Pros: Closes the one uncovered gate; the unit test is one line given the existing harness.
- Cons: The e2e variant needs seeding 25 rows (slower) — the unit test alone is sufficient for the branch.
- Effort: Small
- Risk: Low (test-only)

## Recommended Action
Option A — add coverage. Approved 2026-08-21.

## Resolution
The unit branch was already covered by the `it.each` state-rejection row
`['at active-open ceiling', { activeOpen: 25 }, 422, RFQ_TOO_MANY_ACTIVE]` (asserts 422, the code, `fail`
called, `complete` not called). Added an **e2e** test for end-to-end proof: seed 25 open RFQs for the
registered collector directly via SQL (distinct idempotency hashes), then POST the 26th → 422
`RFQ_TOO_MANY_ACTIVE`. Verified: e2e 11/11, lint clean.

## Technical Details
- The parameterized `it.each` state-rejection block in the service spec is the natural home — add the `activeOpen: 25` row.

## Acceptance Criteria
- [ ] A test asserts 422 `RFQ_TOO_MANY_ACTIVE` at the ceiling, with `fail` called and no insert.
- [ ] `yarn test` green.

## Work Log
- 2026-08-21 — Filed from PR #46 review (pattern-recognition-specialist).

## Resources
- PR #46; `rfqs.service.ts`; `rfqs.service.spec.ts`.
