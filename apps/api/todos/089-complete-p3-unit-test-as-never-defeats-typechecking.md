---
status: complete
priority: p3
issue_id: 089
tags: [code-review, testing, typescript, tov-20]
dependencies: []
---

# `as never` in SEP-10 Unit Test Defeats Type-Checking of Mocks

## Problem Statement
`test/unit/sep10.service.spec.ts` casts the fake `walletsService`/`authService` with `as never`. Because
`never` is assignable to everything, if `WalletsService.findOrCreateForWallet` or
`AuthService.issueTokensForUser` change shape, the test silently keeps compiling instead of failing —
the mock's surface is no longer validated against the real type.

## Findings
- `test/unit/sep10.service.spec.ts:89-90` — `walletsService as never`, `authService as never`.

## Proposed Solutions

### Option A: `satisfies Pick<...>` + `as unknown as`
- **Description:**
  ```ts
  const walletsService = {
    findOrCreateForWallet: (publicKey: string) =>
      Promise.resolve({ user: { id: 'user-1', email: null }, wallet: { publicKey } }),
  } satisfies Pick<WalletsService, 'findOrCreateForWallet'>;
  // ...
  service = new Sep10Service(cfg, repo, walletsService as unknown as WalletsService, authService as unknown as AuthService);
  ```
  `satisfies Pick` compile-checks the mock; `as unknown as` keeps the intended type at the call site.
- **Pros:** Restores compile-time safety on the mocks.
- **Cons:** Slightly more verbose.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — annotate mocks with `Pick<Service, 'method'>`; cast to the full type at the call site.

## Implemented Solution
The `walletsService`/`authService` fakes are now typed `Pick<WalletsService, 'findOrCreateForWallet'>`
and `Pick<AuthService, 'issueTokensForUser'>`, so the mocked method names + signatures are checked against
the real services (a rename or signature change now breaks compilation). The partial return fixtures use
`as unknown as User`/`as unknown as Wallet` (we only need the fields Sep10Service reads), and the
constructor args use `as unknown as WalletsService`/`AuthService` (the Nest services have private members).
`as never` — which is assignable to everything and hid drift — is gone.

## Technical Details
- Changed: `test/unit/sep10.service.spec.ts` (+ imports of `AuthService`, `WalletsService`, `User`, `Wallet`).

## Acceptance Criteria
- [x] Mocks are type-checked against the real service surfaces (`Pick<...>`); a signature change breaks the test.

## Work Log
- 2026-07-02: Filed from PR #20 review (kieran-typescript-reviewer, P2 → tracked P3 as test-only).
- 2026-07-02: Fixed — Pick-typed mocks + call-site casts; unit 8/8, lint clean. Marked complete.
