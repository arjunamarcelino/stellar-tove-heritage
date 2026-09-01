---
status: complete
priority: p3
issue_id: 075
tags: [code-review, testing, quality]
dependencies: []
---

# ThrottlerStorage No-Op Override Duplicated Across 4 E2E Specs

## Problem Statement
The identical `.overrideProvider(ThrottlerStorage).useValue({ increment: () => Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })` block is copy-pasted byte-for-byte across all four e2e specs. The project convention (`test/CLAUDE.md`, `CLAUDE.md`) is to keep shared test utilities in `test/shared/helpers.ts`. A future `@nestjs/throttler` interface change would require editing 4+ sites, and a typo in one copy would silently re-enable throttling in that suite only.

## Findings
- `test/e2e/app.e2e-spec.ts:16-17`, `test/e2e/auth.e2e-spec.ts:36-37`, `test/e2e/backoffice-auth.e2e-spec.ts:61-62`, `test/e2e/backoffice-dashboard.e2e-spec.ts` — identical override.
- `test/shared/helpers.ts` currently holds only `truncateTables`.
- Flagged by pattern (P3) and simplicity (P2).

## Proposed Solutions

### Option A: Export a `noOpThrottlerStorage` value from test/shared/helpers.ts
- **Description:** Define and export the no-op storage object; import it in each spec's `.useValue(noOpThrottlerStorage)`. Update the snippet in `test/CLAUDE.md` to reference the helper.
- **Pros:** One definition; minimal change per spec.
- **Cons:** None.
- **Effort:** Small
- **Risk:** Low

### Option B: Export a `createAppTestingModule()` builder helper
- **Description:** A helper that builds `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage)...` and returns the builder, so specs share the whole setup.
- **Pros:** Removes even more duplication (module import + override).
- **Cons:** Slightly more abstraction; specs still need ValidationPipe/cookieParser wiring.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — export a `noOpThrottlerStorage` value from `test/shared/helpers.ts`.

## Implemented Solution
Applied **Option A**:
- Added a typed `noOpThrottlerStorage: ThrottlerStorage` export to `test/shared/helpers.ts`.
- Replaced the inline `.useValue({ increment: ... })` in all 4 e2e specs (`app`, `auth`,
  `backoffice-auth`, `backoffice-dashboard`) with `.useValue(noOpThrottlerStorage)`, importing
  it from the helper.
- Updated the snippet in `test/CLAUDE.md` to reference the helper.
- Verified: build (TSC 0 issues) + e2e 36/36 green.

## Technical Details
- Affected: `test/shared/helpers.ts`, all 4 `test/e2e/*.e2e-spec.ts`, `test/CLAUDE.md`.

## Acceptance Criteria
- [x] The no-op throttler storage is defined once and reused.
- [x] All e2e suites still pass (36/36).

## Work Log
- 2026-07-01: Filed from PR #17 review (pattern + simplicity reviewers).
- 2026-07-01: Resolved via Option A — added `noOpThrottlerStorage` to `test/shared/helpers.ts`, referenced it in all 4 e2e specs and `test/CLAUDE.md`. Verified build + e2e 36.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
