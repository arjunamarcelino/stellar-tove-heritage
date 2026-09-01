---
status: complete
priority: p2
issue_id: 087
tags: [code-review, architecture, tov-20]
dependencies: []
---

# `WalletsService` Constructs & Persists the `User` Aggregate Directly (Domain Boundary Leak)

## Problem Statement
Inside the transaction, `WalletsService.findOrCreateForWallet` does
`manager.create(User, { email: null, passwordHash: null, isActive: true })` + `manager.save(user)`,
bypassing `UsersService`/`UserRepository`. The wallets domain now encodes User's construction invariants
(which fields default, that wallet-users are credential-less). `WalletsModule` also depends on the `User`
entity without importing `UsersModule` — it works only because entities are globally registered on the
DataSource. This is a justified pragmatic compromise (the atomic insert needs a shared `EntityManager`,
and `UsersService.create()` hard-requires a password via bcrypt), but it is a genuine boundary leak. It is
structural only — entity `@BeforeInsert` hooks still fire via `manager.save`, so there's no correctness bug.

## Findings
- `src/modules/wallets/wallets.service.ts:34-42` — creates + saves `User` directly via `EntityManager`.
- `src/modules/wallets/wallets.module.ts` — no `UsersModule` import; relies on global entity registration.
- `src/modules/users/users.service.ts:~50` — `create()` requires a password (`bcrypt.hash(dto.password)`),
  so no reusable wallet-user factory exists today.

## Proposed Solutions

### Option A: Users domain owns wallet-user creation (transaction-aware)
- **Description:** Add `UsersService.createWalletUser(manager: EntityManager)` (or a `UserRepository`
  factory taking an `EntityManager`) and call it from `WalletsService` inside the same transaction.
- **Pros:** Keeps User invariants in the users module; preserves atomicity.
- **Cons:** Slightly more plumbing to thread the manager.
- **Effort:** Small-Medium
- **Risk:** Low

### Option B: Accept as-is with a comment
- **Description:** Document that wallet onboarding intentionally creates the User inline for atomicity.
- **Pros:** No code change.
- **Cons:** Boundary leak persists; two places know how to build a User.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — users domain owns wallet-user creation via a transaction-aware method.

## Implemented Solution
- Added `UsersService.createWalletUser(manager: EntityManager): Promise<User>` — builds + saves the
  credential-less User inside the caller's transaction, so the User aggregate's invariants live in the
  users module while staying atomic with the wallet insert.
- `WalletsService.findOrCreateForWallet` now calls `this.usersService.createWalletUser(manager)` instead
  of constructing `User` directly; `WalletsModule` imports `UsersModule` (auth already imports both — no
  cycle, since users depends on neither).
- Verified no DI cycle / boot regression (e2e full AppModule boot 7/7; wallets integration 3/3).

## Technical Details
- Changed: `src/modules/users/users.service.ts` (+ `EntityManager` import),
  `src/modules/wallets/wallets.service.ts`, `src/modules/wallets/wallets.module.ts`.

## Acceptance Criteria
- [x] Wallet-only User construction is owned by the users domain (`createWalletUser`) while remaining
  atomic with the wallet insert (shared `EntityManager`).

## Work Log
- 2026-07-02: Filed from PR #20 review (architecture-strategist, P2).
- 2026-07-02: Fixed — moved User creation to UsersService.createWalletUser(manager); no cycle. Marked complete.
