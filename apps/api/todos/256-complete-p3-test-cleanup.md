---
status: complete
priority: p3
issue_id: 256
tags: [code-review, tests, quality, TOV-237, PR-35]
dependencies: []
---

# Test cleanup: doubled call + weak matcher in the service spec; note brittle mock

## Problem Statement
The 503 service test is sloppy in two ways, and one adapter mock tests its own shape. All pass today; cleaning them prevents false confidence.

## Findings
Flagged by kieran-typescript-reviewer (P3.4).
1. `test/unit/modules/me-holdings/me-holdings.service.spec.ts:194-214` — calls `listHoldings` **twice** (once in `rejects.toMatchObject({ constructor: HttpException })`, once in the `try/catch`). The `toMatchObject({ constructor: HttpException })` matcher is a quirky/weak type assertion; the `try/catch` below already does it properly with `toBeInstanceOf` + status + errorCode. The double call also means `cache.set` "not called" is asserted after two invocations. Drop the first assertion; keep the `try/catch` (or use `await expect(...).rejects.toThrow(HttpException)`).
2. `test/unit/modules/me-holdings/soroban-fraction-read.service.spec.ts` — the `ok()` retval wrapper `{ result: { retval: { v: bigint } } }` + mocked `scValToBigInt: (r) => r.v` is self-consistent but couples the test to this decode path (a switch to a different retval field would keep passing). Acceptable (comment flags it), noted as a coverage seam.

## Proposed Solutions
1. Fix #1 (remove the doubled call + weak matcher). Effort: Small. Add a `now === lockupEndMs` boundary test here too (see todo 244). Optionally tighten #2's mock. Risk: none.

## Recommended Action
**RESOLVED — #1 fixed.** The 503 test now calls `listHoldings` **once** inside a single `try/catch`, dropping the doubled call and the weak `toMatchObject({ constructor: HttpException })` matcher; it asserts `toBeInstanceOf(HttpException)` + status + errorCode + message on that one invocation, then `cache.set` not called. #2 (the inclusive-end boundary test) was already added under todo 244; the adapter `ok()` mock note is acknowledged and left as-is (it's a documented, acceptable seam).

## Technical Details
- `test/unit/modules/me-holdings/me-holdings.service.spec.ts` (503 test).

## Acceptance Criteria
- [x] 503 test asserts type/status/errorCode/message once via a single call.
- [x] Boundary test present (added in todo 244).

## Work Log
- 2026-07-18: created from PR #35 review (kieran-typescript-reviewer P3.4).
- 2026-07-18: RESOLVED — single-call 503 assertion; 12 service tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
