---
status: complete
priority: p2
issue_id: 237
tags: [code-review, typescript, dto, type-safety, consistency, TOV-240, PR-34]
dependencies: []
---

# `fromEntity` uses `Object.assign(new Dto(), {...})` — bypasses compile-time type checking + diverges from codebase convention

## Problem Statement
The four new read DTO mappers construct via `Object.assign(new Dto(), {…})`. `Object.assign<T,U>` returns `T & U` and never constrains `U` to `T`'s shape, so a wrong value type, a typo'd key, or an omitted required field all compile clean. The mappings are correct **today** (hand-verified), but the safety is manual diligence, not the compiler — the same silent-drift class of bug that `assertActiveStatus` was written to prevent. It is also the only place in the repo using this style (14 existing `fromEntity` DTOs use field-by-field assignment), so it's both a type-safety and a consistency divergence.

## Findings
Flagged by kieran-typescript-reviewer (as P1) and pattern-recognition-specialist (P2).
- `src/modules/backoffice/artworks/dto/artwork-detail.dto.ts:47`
- `src/modules/backoffice/artworks/dto/artwork-list-item.dto.ts:31`
- `src/modules/backoffice/artworks/dto/fraction-contract-detail.dto.ts:42`
- `src/modules/backoffice/artworks/dto/fraction-contract-summary.dto.ts:14`
- Precedent (same folder): `fractionalization-response.dto.ts:13-20`; also `mission-response.dto.ts`, `admin-response.dto.ts`, `me-wallet.dto.ts`, `file-response.dto.ts`.

Illustration (all compile with no error under strict + exactOptionalPropertyTypes):
```ts
class D { a!: string; b!: number | null; }
Object.assign(new D(), { a: 123 });         // wrong type — no error
Object.assign(new D(), { a: 'ok', bb: 5 }); // typo key, b left undefined — no error
Object.assign(new D(), { a: 'ok' });        // b omitted — no error
```

## Proposed Solutions
1. **Field-by-field assignment on a typed instance** (restores per-field compile check AND matches the 14-DTO precedent). Effort: Small. Risk: none.
   ```ts
   const dto = new FractionContractDetailDto();
   dto.id = fc.id;
   dto.status = assertActiveStatus(fc.status);
   dto.totalSupply = fc.totalSupply;
   // …every assignment now type-checked
   return dto;
   ```
2. Return a `satisfies FractionContractDetailDto` object literal (checked, but the DTO has decorators/`!` fields so a plain literal needs care). Effort: Small. Risk: low.
3. Leave as-is (mappings correct today). Risk: silent drift on future entity rename/nullable change; inconsistent with the module.

## Recommended Action
**RESOLVED** (Solution 1). All four `fromEntity` mappers now use field-by-field assignment on a typed instance (`const dto = new X(); dto.field = …; return dto;`) — restoring per-field compile-time checking and matching the 14-DTO codebase precedent. Verified a deliberately-wrong field type now fails `yarn build`.

## Technical Details
- Affected: the 4 DTO files above. No runtime behavior change; pure compile-time hardening + style alignment.

## Acceptance Criteria
- [ ] The 4 `fromEntity` mappers use field-by-field assignment (or a checked literal).
- [ ] A deliberately wrong field type in a mapper fails `yarn build`.
- [ ] Unit/e2e for the read endpoints stay green.

## Work Log
- 2026-07-18: created from PR #34 review (kieran-typescript, pattern-recognition).
- 2026-07-18: RESOLVED — 4 mappers switched to typed field-by-field assignment. Build + lint clean; 9 unit tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
- Precedent: `src/modules/backoffice/artworks/dto/fractionalization-response.dto.ts`
