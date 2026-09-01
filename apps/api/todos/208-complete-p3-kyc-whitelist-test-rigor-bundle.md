---
status: complete
priority: p3
issue_id: 208
tags: [code-review, testing, quality, kyc, TOV-29, PR-31]
dependencies: []
---

# Test-rigor bundle: assert the CHECK error code, tighten seed/stub types, add a soft-delete comment, drop a low-value test

## Problem Statement
A cluster of small test-quality improvements from the review. Each is minor; bundled to avoid
fragmentation.

## Findings
1. **CHECK-reject asserts only `toThrow()`** — `test/integration/modules/kyc/kyc-whitelist-status.integration.spec.ts:163-170` asserts `.rejects.toThrow()` with no code check, so it also passes if the INSERT fails for an unrelated reason (NOT NULL, table typo, a different constraint). The comment claims "23514 check_violation" but doesn't verify it. (test-quality P3.)
2. **`Seed.status` typed as `string`** — `kyc-whitelist-status.integration.spec.ts:36-40` — weaker than it should be for a PR about enum↔string coupling; a typo (`'whitelistd'`) becomes a runtime CHECK failure instead of a compile error. (kieran-typescript P3.)
3. **Over-broad `as KycSubmission` cast** — `test/unit/modules/kyc/whitelist-status-response.dto.spec.ts:19-21` `return { createdAt } as KycSubmission;` suppresses all missing-property errors; would silently pass if `build()` started reading another submission field. (kieran-typescript P3, test-quality P3.)
4. **Implicit soft-delete reliance undocumented** — `src/modules/kyc/repositories/kyc-submission.repository.ts:16-21` `findLatestByUser` relies on `findOne`'s auto-appended `deleted_at IS NULL`; a future switch to `createQueryBuilder` (which does NOT auto-filter) would silently leak soft-deleted submission timestamps into the endpoint. (data-integrity P3.)
5. **Low-value varchar-length test** — `test/unit/modules/kyc/kyc-status.enum.spec.ts:26-28` asserts each `KycStatus` literal is ≤16 chars; a static fact also caught by the CHK-parity integration test + the migration. (simplicity P3.)

## Proposed Solutions
### Option A (recommended): apply the five small fixes
1. `.rejects.toMatchObject({ code: '23514' })` (or `{ driverError: { code: '23514' } }`), or assert the message contains `CHK_users_kyc_status`.
2. Type `Seed.status` as `KycStatus` (string enum interpolates identically into the SQL param).
3. Return `Pick<KycSubmission, 'createdAt'>` from the stub helper and narrow `build()`'s second param to `Pick<KycSubmission, 'createdAt'> | null` (mirrors the already-narrowed `Pick<User,…>` first param).
4. Add a one-line comment on `findLatestByUser` pinning the reliance on `findOne`'s implicit soft-delete filter (and that callers must gate on user existence).
5. Drop the varchar-length assertion (keep the other three parity assertions in that spec).

**Effort: Small (all five).**

## Recommended Action
**RESOLVED (Option A — all five applied).** (1) CHECK-reject now asserts `.rejects.toThrow(/CHK_users_kyc_status/)`
so an unrelated INSERT failure can't pass it. (2) `Seed.status` typed as `KycStatus` (seed literals converted to
enum members). (3) The submission stub returns `Pick<KycSubmission,'createdAt'>` (no `as` cast) and `build()`'s
second param was narrowed to `Pick<KycSubmission,'createdAt'> | null`, mirroring the already-narrowed
`Pick<User,…>` first param. (4) `findLatestByUser` now documents its reliance on `findOne`'s implicit
soft-delete filter. (5) The low-value varchar(16)-length enum test was dropped (a static fact also guarded by
the CHK-parity integration test).

## Technical Details
- Affected: the three whitelist test files + `src/modules/kyc/repositories/kyc-submission.repository.ts` (comment) + `whitelist-status-response.dto.ts` (optional `build()` param narrowing).

## Acceptance Criteria
- [ ] CHECK-reject test asserts the specific violation (code `23514` or constraint name).
- [ ] `Seed.status` is `KycStatus`-typed; the submission stub uses `Pick<KycSubmission,'createdAt'>`.
- [ ] `findLatestByUser` documents its implicit soft-delete reliance.
- [ ] The redundant varchar-length assertion is removed.

## Work Log
- 2026-07-17: Filed from PR #31 review (test-quality + kieran-typescript + data-integrity + simplicity, all P3). No code changed.
- 2026-07-17: RESOLVED. All five fixes applied across the enum/dto/integration specs + repo comment + build() param narrowing. build/lint/unit(425)/integration green. Status → complete.
