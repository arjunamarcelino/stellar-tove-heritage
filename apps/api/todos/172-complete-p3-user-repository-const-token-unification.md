---
status: complete
priority: p3
issue_id: 172
tags: [code-review, architecture, quality, users, cross-cutting]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Added `export const USER_REPOSITORY = 'IUserRepository'` to
`user-repository.interface.ts` (value unchanged, so no DI break) and replaced every `@Inject('IUserRepository')`
/ `{ provide: 'IUserRepository' }` with the const across production code (`users.module.ts`,
`users.service.ts`, `handle/handle.service.ts`) and the test providers that register it
(`users.service.spec.ts`, `auth.integration.spec.ts`, `users.integration.spec.ts`,
`handle.integration.spec.ts`). Updated the doc references in `public-handle.module.ts` and
`src/modules/CLAUDE.md`. Now matches the `WALLET_REPOSITORY` const-token convention; no stringly-typed
magic string remains for this token. Build clean; users/handle unit + users/auth/handle integration
suites green (39 tests).

# `'IUserRepository'` string token vs the newer `WALLET_REPOSITORY` const-token convention

## Problem Statement
The wallets domain standardized on an exported const token co-located with the interface
(`export const WALLET_REPOSITORY = 'IWalletRepository'`, likewise `PASSKEY_CREDENTIAL_REPOSITORY`,
`INTERNAL_AUDIT_LOG_REPOSITORY`, `KYC_ALLOWLIST_REPOSITORY`). The users domain still uses the bare
string `'IUserRepository'`, which is stringly-typed and refactor-fragile. TOV-26's `HandleService`
injects the same bare string.

This is **consistent with its host module** — `UsersService` already injects `'IUserRepository'`, and
the new code correctly matched the existing users convention rather than inventing a third variant. So
it is not a defect in this PR; it's a pre-existing inconsistency between the older `users` module and the
newer `wallets` modules.

## Findings
- `src/modules/users/users.module.ts:10` — `{ provide: 'IUserRepository', useClass: UserRepository }` (string).
- `src/modules/users/handle/handle.service.ts:20` — `@Inject('IUserRepository')` (string).
- `src/modules/users/users.service.ts:15` — pre-existing `@Inject('IUserRepository')`.
- `src/modules/wallets/repositories/wallet-repository.interface.ts:4` — `WALLET_REPOSITORY` const-token precedent.

## Proposed Solutions
### Option A: Extract `USER_REPOSITORY` const token
- Add `export const USER_REPOSITORY = 'IUserRepository'` in `user-repository.interface.ts`; update
  `users.module.ts`, `users.service.ts`, and `handle.service.ts` injection sites. Token value unchanged →
  no DI break.
- **Pros:** unifies with the wallets convention; kills the magic string. **Cons:** touches existing files
  beyond TOV-26; belongs in a dedicated refactor. **Effort: Small.**

### Option B: Leave as-is
- **Pros:** new code matches its host module; no churn. **Cons:** the two-convention split persists.
  **Effort: None.**

## Recommended Action
_(triage — defer to a token-unification refactor; not a TOV-26 concern since the new code correctly
conforms to its host module.)_

## Technical Details
- Files: `src/modules/users/repositories/user-repository.interface.ts`, `users.module.ts`, `users.service.ts`,
  `src/modules/users/handle/handle.service.ts`.

## Acceptance Criteria
- [ ] Decision recorded; if pursued, `USER_REPOSITORY` const replaces the string token at all injection sites.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (architecture-strategist). New code correctly matched
  the users-module convention; this is a pre-existing cross-module inconsistency.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
