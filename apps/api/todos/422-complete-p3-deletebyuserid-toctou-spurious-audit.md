---
status: complete
priority: p3
issue_id: 422
tags: [code-review, tov-31, pr-54, concurrency, audit, data-integrity]
dependencies: []
---
# `deleteByUserId` TOCTOU can write a spurious second `beneficiary.removed` audit row

## Resolution (2026-08-26)
Option A. Replaced find-then-delete with a single atomic `DELETE … WHERE user_id AND deleted_at IS NULL
RETURNING id` via QueryBuilder; returns `res.raw[0]?.id ?? null`. Now a concurrent DELETE that removes the
row first makes the loser's statement match 0 rows → returns `null` → the service writes no audit, so a
double-DELETE yields at most one `beneficiary.removed` row. Also removes the extra round-trip. `beneficiary.repository.ts:48-61`. Build 0 issues; beneficiary integration 8/8 green (delete + idempotent no-op + erasure paths).

## Problem Statement
`deleteByUserId` is find-then-delete with no `FOR UPDATE` and, critically, does **not** check `delete().affected` — it returns `row.id` unconditionally after any `findOne` hit. Under two concurrent `DELETE /me/beneficiary` requests (same user), both `findOne` the same row; the first physically deletes it and audits `beneficiary.removed`; the second's `repo.delete({ id })` affects **0 rows** but still returns the id, so the service writes a **second** `beneficiary.removed` audit row for a deletion this transaction did not actually perform. Not corruption (the audit table has no FK to the deleted id — intended and fine), but the audit log overstates removals.

## Findings
1. **Unconditional id return.** `src/modules/users/beneficiary/repositories/beneficiary.repository.ts:48-54` — `const row = await repo.findOne(...); if (!row) return null; await repo.delete({ id: row.id }); return row.id;` never inspects the `DELETE` result. `src/modules/users/beneficiary/beneficiary.service.ts:86-93` audits whenever `removedId !== null`. (data-integrity-guardian **P3**)
2. **Also a performance micro-note (P3, not worth changing):** find-then-delete is 2 queries; a single `DELETE … WHERE user_id=$1 RETURNING id` would be atomic and also close this TOCTOU — but performance-oracle rated the round-trip saving negligible at this volume. The *correctness* angle (spurious audit) is the reason to consider it, not speed.

## Proposed Solutions
### Option A — Single `DELETE … RETURNING id` (Recommended)
Replace find-then-delete with a QueryBuilder `.delete().where('user_id = :userId').returning('id').execute()`; return `raw[0]?.id ?? null`. Atomic, no TOCTOU, no spurious audit, one round-trip. Effort: Small · Risk: Low (verify the pg driver returns `raw` as expected — see `docs/solutions/integration-issues/typeorm-insert-orignore-returning-generatedmaps-empty-object-on-conflict.md` for the returning-shape caveat).
### Option B — Gate on affected count
Keep find-then-delete but capture `res.affected` from `repo.delete(...)` and return `null` when 0, so the audit only fires on a real removal. Effort: Trivial · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/beneficiary/repositories/beneficiary.repository.ts:48-54`.

## Acceptance Criteria
- [ ] A concurrent double-DELETE produces at most one `beneficiary.removed` audit row.

## Work Log
- 2026-08-26: Filed from PR #54 data-integrity review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
