---
status: complete
priority: p2
issue_id: 028
tags: [code-review, typescript, type-safety]
dependencies: []
---

# CurrentUser Decorator Type Safety Regression

## Problem Statement
The `CurrentUser` decorator was modified from using `keyof JwtPayload` to `string` with a double-cast (`as unknown as Record<string, unknown>`). This loses compile-time safety for property access on the JWT payload, allowing typos and invalid property names to pass the type checker.

## Findings
- `src/common/decorators/current-user.decorator.ts` uses `string` instead of `keyof JwtPayload` for the field parameter
- Double-cast `as unknown as Record<string, unknown>` bypasses TypeScript's type system
- Previously, accessing `@CurrentUser('emal')` (typo) would be caught at compile time; now it silently passes

## Proposed Solutions

### Option A: Restore generic keyof typing with discriminated union support
- **Description:** Use a generic parameter that accepts `keyof UserJwtPayload | keyof AdminJwtPayload` or the full `keyof JwtPayload`. If the discriminated union makes direct keyof difficult, use the intersection of all possible keys.
- **Pros:** Restores compile-time safety; catches typos; IntelliSense works
- **Cons:** May require more complex generic signature
- **Effort:** Small
- **Risk:** Low

### Option B: Accept string but add runtime validation
- **Description:** Keep `string` parameter but validate the key exists at runtime with a clear error message.
- **Pros:** Works with any payload shape; catches errors at runtime
- **Cons:** No compile-time safety; errors only at runtime
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented. Changed parameter type from `string` to `keyof JwtPayload` and removed the double-cast. Since both `UserJwtPayload` and `AdminJwtPayload` share the same property names, `keyof JwtPayload` resolves to all valid keys.

## Technical Details
- **Affected files:** `src/common/decorators/current-user.decorator.ts`
- **Components:** CurrentUser decorator

## Acceptance Criteria
- [x] `@CurrentUser('nonexistent')` produces a TypeScript compile error
- [x] Valid properties like `@CurrentUser('sub')`, `@CurrentUser('email')` work correctly
- [x] No double-cast or `as unknown` patterns

## Work Log
- 2026-05-21: Created from PR #2 code review (TypeScript reviewer)
- 2026-05-21: Resolved. Changed `data: string | undefined` to `data: keyof JwtPayload | undefined`. Removed `(user as unknown as Record<string, unknown>)[data]` cast, replaced with `user[data]`.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
