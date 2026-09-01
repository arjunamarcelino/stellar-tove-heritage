---
status: complete
priority: p2
issue_id: 169
tags: [code-review, typescript, quality, handle, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (test the invariant; kept the class DTO for Swagger). Added
`test/unit/modules/handle/handle.service.spec.ts` — constructs `HandleService` with a fake
`IUserRepository` and asserts, across all four `check()` outcomes (available / taken / reserved /
invalid_format), that **`reason` is present iff `available` is false** (`res.reason !== undefined` ===
`res.available === false`), plus the concrete expected `available`/`reason`/`handle` per case. If any
`check()` return site drifts, the test fails — closing the gap the class-DTO type can't police. Chose
Option A over the discriminated-union refactor (Option B) since the DTO must stay a decorated class for
`@ApiProperty`. Handle unit suite green (12 tests: 8 format + 4 invariant).

# `CheckHandleResponseDto` invariant ("reason present iff unavailable") is not type-enforced or tested

## Problem Statement
`CheckHandleResponseDto` documents the invariant "`reason` is present iff `available` is false" in its
doc comment, and `HandleService.check()` upholds it across its four return sites. But the DTO is a
**product type**, not a discriminated union:

```ts
handle!: string;
available!: boolean;
reason?: HandleReason;
```

This admits illegal states — `{ available: true, reason: 'taken' }` and `{ available: false }` — that the
comment forbids. The comment is doing the type system's job. A future edit to any of the four `check()`
return sites can silently violate the documented contract with **zero compiler pushback** and no test to
catch it.

The DTO is a class (not a plain union) because `@ApiProperty` decorators must live on it for Swagger —
you can't decorate a union type. So the class form is a legitimate constraint, not an oversight; the gap
is that nothing (compiler or test) guards the invariant.

## Findings
- `src/modules/users/handle/dto/check-handle-response.dto.ts:10-22` — product-type DTO with optional `reason`.
- `src/modules/users/handle/handle.service.ts:22-29` — `check()` upholds the invariant by convention only.
- No unit/e2e assertion that `reason` presence tracks `available` (e2e checks specific cases, not the invariant).

## Proposed Solutions
### Option A: Add a unit test asserting the invariant (recommended)
- Test that for every `check()` outcome, `available === false` ⟺ `reason !== undefined` (and `available: true`
  omits `reason`). Cheap, and it fails loudly if a future return site drifts.
- **Pros:** closes the gap without changing the Swagger contract. **Cons:** a test, not a compile-time guard.
  **Effort: Small.**

### Option B: Service returns a discriminated union, DTO stays for Swagger
- Define `type CheckHandleResult = { handle: string; available: true } | { handle: string; available: false; reason: HandleReason }`;
  `check()` returns it; map to the class DTO at the boundary.
- **Pros:** compiler enforces the invariant at the four return sites. **Cons:** extra type + a mapping step;
  the class still can't express it for Swagger. **Effort: Medium.**

## Recommended Action
_(triage — Option A gives most of the value for little cost; Option B if you want compile-time enforcement)_

## Technical Details
- Files: `test/unit/modules/handle/` (new invariant test) and/or `handle.service.ts` + the DTO (Option B).

## Acceptance Criteria
- [ ] A test asserts `reason` is present iff `available` is false across all `check()` outcomes, OR
- [ ] `check()` returns a discriminated union that makes the invalid states uncompilable.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (kieran-typescript-reviewer). The class-DTO form is
  correct for Swagger; the invariant just needs a guard the type can't provide.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
