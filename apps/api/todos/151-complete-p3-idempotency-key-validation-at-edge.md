---
status: complete
priority: p3
issue_id: 151
tags: [code-review, quality, wallets, TOV-24]
dependencies: []
---

# `Idempotency-Key` header: validate at the edge (typing + charset), not deep in the service

## Problem Statement
The `Idempotency-Key` presence/length/trim rules live imperatively inside `MeWalletsService.idempotencyKey`,
which (a) drags a `BadRequestException` special-case into the `http()` helper, and (b) diverges from the
codebase convention of declarative input validation. The controller also types the header as
`idempotencyKey: string` though NestJS passes `undefined` when it's absent — a contract the service silently
patches with `rawKey?.trim()`. No charset restriction is applied (defense-in-depth).

## Findings
- `src/modules/wallets/export/me-wallets.controller.ts` — `@Headers('idempotency-key') idempotencyKey: string`
  (should be `string | undefined`).
- `src/modules/wallets/export/me-wallets.service.ts` — `idempotencyKey()` presence/length/trim + the
  `BadRequestException` branch in `http()`.
- kieran-typescript (P2 typing), simplicity + pattern (P3 edge-validation), security (P3 charset).

## Proposed Solutions

### Option A: A small header pipe / required-header validator at the controller (recommended)
Validate presence/length/charset (`[A-Za-z0-9._-]`, ≤255) at the controller with a pipe emitting the standard
`VALIDATION_FAILED` 400; widen the param type to `string | undefined`. This lets the `BadRequestException`
branch in `http()` (see [[145]]) disappear.
- **Pros:** Declarative, edge-validated, unblocks the `http()` cleanup; charset hardening.
- **Cons:** A tiny custom pipe (headers aren't DTO-validated by Nest by default).
- **Effort:** Small · **Risk:** Low

### Option B: Keep it in the service but fix the type + add charset check
- **Pros:** Minimal.
- **Cons:** Leaves the convention divergence + the coupled `http()` branch.
- **Effort:** Small · **Risk:** Low

## Recommended Action
Option A (edge validation). Implemented as a **custom param decorator** rather than a pipe, because
`@Headers` does not accept a pipe argument (unlike `@Param`/`@Body`).

## Implemented Solution
- New **`src/common/decorators/idempotency-key.decorator.ts`** — `@IdempotencyKey()` param decorator +
  exported `parseIdempotencyKey(value)` helper: requires present, ≤255 chars, charset `[A-Za-z0-9._-]`
  (blocks Redis-key-separator injection) → 400 `VALIDATION_FAILED` at the edge; returns the trimmed key.
- Controller `add()` uses `@IdempotencyKey() idempotencyKey: string` (dropped `@Headers` + its import).
- `MeWalletsService`: removed the imperative presence/length check + `MAX_IDEMPOTENCY_KEY_LEN`; `add()` now
  trusts the validated key and just formats the Redis key.
- Tests: added `parseIdempotencyKey` unit spec (undefined/blank/too-long/charset → 400); removed the
  service-level blank-key test (now covered by the decorator + the existing e2e missing-header 400).

Build/lint clean; decorator unit (7) + me-wallets e2e (9) green.

## Technical Details
Affected: new `idempotency-key.decorator.ts`; `me-wallets.controller.ts`; `me-wallets.service.ts`. The
`BadRequestException`/`http()` branch removed in [[145]] is now fully retired.

## Acceptance Criteria
- [x] Missing/blank/oversized/invalid-charset `Idempotency-Key` → 400 at the edge.
- [x] Header value validated at the boundary; the raw header type (`string | undefined`) handled in the decorator.

## Work Log
- 2026-07-15: Filed from PR #26 review (kieran P2, simplicity/pattern/security P3).
- 2026-07-15: Moved validation to a `@IdempotencyKey()` param decorator (pipe wasn't viable on `@Headers`);
  service simplified; charset hardening added. Green.
