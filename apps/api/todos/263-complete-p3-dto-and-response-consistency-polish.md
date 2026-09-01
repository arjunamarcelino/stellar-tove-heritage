---
status: complete
priority: p3
issue_id: 263
tags: [code-review, quality, consistency, docs, TOV-152, PR-36]
dependencies: []
---

# DTO/response polish: stale route comment, type-only import, and omitted `fractionContractId`

## Problem Statement
Three small consistency deviations from the sibling conventions, all in the offerings DTOs. None affect behavior; grouped because they're trivial edits in adjacent files.

## Findings
Flagged by **pattern-recognition-specialist (3× P3)**.
1. **Stale route path in doc comment** — `src/modules/backoffice/offerings/dto/create-offering.dto.ts` doc reads "Body for `POST /admin/offerings`". The real route is `POST /api/backoffice/v1/offerings` (`@Controller('offerings')` under the backoffice `RouterModule` prefix); `/admin/…` is used nowhere in this codebase.
2. **Type-only symbol imported as a value** — `src/modules/offerings/entities/offering.entity.ts` uses `import { OfferingStatus }` for a type-only annotation; the sibling entity uses `import type { ArtworkStatus }`. Compiles fine (no `verbatimModuleSyntax`), pure consistency.
3. **Response DTO omits `fractionContractId`** — the entity carries it and the service writes it to the audit payload, but `OfferingResponseDto` omits it, whereas the sibling `FractionalizationResponseDto` deliberately surfaces its `fractionContractId`. For an admin planning response, exposing which `fraction_contracts` row the float came from would match the sibling's projection breadth. (Interacts with todo 260/259 — decide provenance exposure holistically.)

## Proposed Solutions
1. Fix (1) and (2) directly (trivial). For (3), decide: add `@ApiProperty() fractionContractId` to the response, or add a one-line note that the omission is intentional (keeps the response minimal). Effort: Small.

## Recommended Action
**RESOLVED — all three (user confirmed expose for (3)).** (1) DTO doc comment now reads `POST
/api/backoffice/v1/offerings`. (2) `OfferingStatus` imported with `import type`. (3) `fractionContractId`
added to `OfferingResponseDto` + `fromEntity` (matches the sibling `FractionalizationResponseDto`); unit
happy-path and e2e happy-path now assert it.

## Technical Details
- `src/modules/backoffice/offerings/dto/create-offering.dto.ts`
- `src/modules/offerings/entities/offering.entity.ts`
- `src/modules/backoffice/offerings/dto/offering-response.dto.ts`

## Acceptance Criteria
- [x] Doc comment shows the real backoffice route.
- [x] `OfferingStatus` imported with `import type`.
- [x] `fractionContractId` exposed in the response (+ asserted in unit & e2e).

## Work Log
- 2026-08-18: created from PR #36 review (pattern-recognition-specialist, 3× P3).
- 2026-08-18: RESOLVED — route comment fixed, `import type`, `fractionContractId` exposed in response DTO. Build + lint green; unit 45, e2e 9.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
