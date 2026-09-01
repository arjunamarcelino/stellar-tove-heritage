---
status: complete
priority: p2
issue_id: 074
tags: [code-review, architecture, di]
dependencies: []
---

# Global AuthGuard Resolves JwtService via a Re-export from the Public Module

## Problem Statement
The app-level `AuthGuard` (registered as `APP_GUARD` in `AppModule`) depends on `JwtService`. That dependency is now satisfied only because `PublicApiModule` does `exports: [AuthModule]` (which exports `JwtModule`). `AuthGuard` is cross-cutting infrastructure, but its provider dependency is routed transitively through a module named "public API" — a hidden, non-obvious coupling. If `AuthModule` is ever moved out of the public grouping, the global guard breaks at runtime with an opaque DI error in `app.module.ts`, which has no visible reference to auth. Previously `AppModule` imported `AuthModule` directly, making the dependency explicit.

## Findings
- `src/modules/public-api.module.ts:30` — `exports: [AuthModule]` added solely for the global guard.
- `src/app.module.ts` — `APP_GUARD` `AuthGuard` has no visible JWT import; relies on the re-export.
- Flagged by architecture-strategist (P2).

## Proposed Solutions

### Option A: Make the guard's JWT dependency explicit at app level
- **Description:** Have `AppModule` import `JwtModule.register({})` (or a small shared `AuthInfraModule` exporting `JwtService`) directly for the global guard, independent of whether `AuthModule` is also a public leaf. Remove the `exports: [AuthModule]` from `PublicApiModule`.
- **Pros:** Dependency is explicit where the guard is registered; `PublicApiModule` owns only routing/grouping.
- **Cons:** One extra import in AppModule; must ensure single JwtService semantics (guards pass explicit secrets, so a bare register({}) is fine).
- **Effort:** Small
- **Risk:** Low

### Option B: Keep the re-export but document it
- **Description:** Leave as-is; add a comment in `app.module.ts` explaining that `AuthGuard`'s `JwtService` comes from `PublicApiModule`'s re-export.
- **Pros:** Minimal.
- **Cons:** Coupling remains; comment can rot.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — make the guard's JWT dependency explicit at the app level.

## Implemented Solution
Applied **Option A**:

- `src/app.module.ts` now imports `JwtModule.register({})` directly, so the `APP_GUARD`
  `AuthGuard` resolves `JwtService` from AppModule's own scope (with an explanatory comment).
  The guard passes explicit secrets to `verifyAsync`, so a bare `register({})` instance is
  correct.
- `src/modules/public-api.module.ts` dropped `exports: [AuthModule]`; it now owns only routing
  and grouping. The global guard no longer depends on a re-export from the public surface.

## Technical Details
- Changed: `src/app.module.ts`, `src/modules/public-api.module.ts`.

## Acceptance Criteria
- [x] The global `AuthGuard`'s `JwtService` dependency is satisfied at the app level, independent of `AuthModule`'s grouping.
- [x] App boots; auth-protected e2e tests pass (36/36); unit 164; build clean.

## Work Log
- 2026-07-01: Filed from PR #17 review (architecture-strategist).
- 2026-07-01: Resolved via Option A — AppModule imports JwtModule.register({}); removed exports:[AuthModule] from PublicApiModule. Verified build + unit 164 + e2e 36 (AuthGuard resolves JwtService with no re-export).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
