---
status: complete
priority: p3
issue_id: 360
tags: [code-review, quality, simplicity, tov-172]
dependencies: []
---
# RFQ minor polish (redundant filter, untyped const, index no-op predicate, type asymmetry) (PR #46)

## Problem Statement
A cluster of small, non-blocking cleanups surfaced across the review. Bundled into one todo — each is a
one-liner and none affects correctness.

## Findings

1. **Redundant `deletedAt: IsNull()`** — `rfq.repository.ts:49` (`countActiveOpenByCollector`). TypeORM's
   `.count()` already appends `WHERE deleted_at IS NULL` (soft-delete column), and `fn_rfqs_guard` blocks
   soft-delete entirely, so the explicit filter (and the `IsNull` import) is dead. *Sources: code-simplicity-reviewer,
   kieran-typescript-reviewer.*

2. **`const DEPLOYED = 'deployed'` is untyped** — `rfqs.service.ts:28` (used `:118`). Inferred as `string`, so it
   lacks the compile-time safety the repo's typed literals have (`const R_OPEN: RfqStatus = 'open'`). Either inline
   `contract.status !== 'deployed'` (matches `offering-planning.helpers`/`fraction-contract.repository` precedent) or
   type it `const DEPLOYED: FractionContractStatus = 'deployed'`. *Source: pattern-recognition-specialist.*

3. **`IDX_rfqs_artwork` partial predicate is a no-op** — migration `…041:67-69`. `WHERE deleted_at IS NULL` is
   always true because the guard trigger forbids soft-delete, so the `WHERE` is misleading (a plain index is
   equivalent). Also note there is no create-path reader for this index yet (write amplification until FR-06.02's
   read lands). *Source: performance-oracle.* (Related: todo #349.)

4. **Entity `status` column omits explicit `name`** — `rfq.entity.ts`. Every other column passes
   `name: 'snake_case'`; `status` relies on the default. Harmless, cosmetically inconsistent. *Source:
   pattern-recognition-specialist.*

5. **`fraction_count` number-vs-string asymmetry** — `create-rfq.dto.ts:19-22`. `fraction_count` is a JS `number`
   capped at `Number.MAX_SAFE_INTEGER` (~2^53) while the column/`CHK_rfqs_count` domain is 2^96−1 and the sibling
   `max_price_per_fraction_stroops` is a canonical string. Not a precision bug (safe-int → BigInt is exact) and it
   mirrors `SubmitBidDto.count`, but confirm the cap is intentional (a collector can't RFQ > 2^53 fractions).
   *Sources: data-integrity-guardian, kieran-typescript-reviewer.*

6. **`begin.body as RfqResponseDto` cast** — `rfqs.service.ts:69`. The replayed body is cast from `unknown` with no
   shape validation (mirrors offerings, acceptable). A comment pinning the contract, or a light shape assert, would
   harden it. *Source: kieran-typescript-reviewer.*

## Proposed Solutions
### Option A — Apply items 1, 2, 4 (pure cleanup); decide 3/5/6 explicitly
- Description: Drop the redundant filter + import (1), type/inline the `DEPLOYED` const (2), add the `name` on
  `status` (4). Items 3 (index predicate — resolve with todo #349), 5 (count type — confirm intentional), and 6
  (cast — add a comment) are judgment calls to record.
- Pros: Small, safe consistency wins.
- Cons: Several tiny diffs.
- Effort: Small
- Risk: Low

## Recommended Action
Apply 1, 2, 4, 6; record 3 and 5 as intentional. Approved 2026-08-21.

## Resolution
1. **Redundant `deletedAt: IsNull()`** — removed from `countActiveOpenByCollector` (and the `IsNull` import);
   TypeORM's `count()` already excludes soft-deleted rows and the guard trigger blocks soft-delete.
2. **`DEPLOYED` const typed** — now `const DEPLOYED: FractionContractStatus = 'deployed'` (imported the type),
   so a typo is a compile error like the repo's `R_OPEN`.
3. **`IDX_rfqs_artwork` partial predicate** — KEPT `WHERE deleted_at IS NULL`: the database CLAUDE.md rule
   ("every soft-delete table must have partial indexes") wins over the (correct) observation that the trigger
   makes it a no-op today. No change; documented as intentional convention.
4. **Entity `status` column** — added the explicit `name: 'status'` for uniformity with the other columns.
5. **`fraction_count` number cap** — INTENTIONAL: mirrors `SubmitBidDto.count` (`@IsInt @Max(MAX_SAFE_INTEGER)`);
   a request for > 2^53 fractions is not a real use case, and safe-int → BigInt/String is exact. No change.
6. **`begin.body as RfqResponseDto` cast** — added a comment pinning the contract (the stored snapshot IS the
   exact DTO persisted by a prior create; the store round-trips it as opaque JSON).

Verified: build 0, lint clean, RFQ unit 43/43, integration 6/6.

## Acceptance Criteria
- [ ] Items 1, 2, 4 applied or explicitly declined.
- [ ] Items 3, 5, 6 have a recorded decision.
- [ ] build + lint + suite green.

## Work Log
- 2026-08-21 — Filed from PR #46 review (simplicity, kieran-ts, pattern, performance, data-integrity).

## Resources
- PR #46; `rfq.repository.ts`, `rfqs.service.ts`, `rfq.entity.ts`, `create-rfq.dto.ts`, migration `1716000000041`.
