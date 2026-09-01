---
status: complete
priority: p2
issue_id: "061"
tags: [code-review, typescript, safety]
dependencies: []
---

# Non-null assertion on getRawOne result

## Problem Statement

`mission.repository.ts:45` uses a non-null assertion (`result!.total`) on the return value of `getRawOne()`, which returns `T | undefined`. While `COUNT(*)` without `GROUP BY` always returns a row in PostgreSQL (making this safe in practice), the `!` operator hides this assumption from TypeScript's type checker.

## Findings

- **Source:** TypeScript Reviewer
- **File:** `src/modules/backoffice/missions/repositories/mission.repository.ts:45`
- **Current code:** `return [parseInt(result!.total, 10), parseInt(result!.active, 10)];`
- **Risk:** If the query somehow fails to return a row, this crashes with `Cannot read properties of undefined`

## Proposed Solutions

### Option A: Nullish coalescing fallback (Recommended)
```typescript
const total = result?.total ?? '0';
const active = result?.active ?? '0';
return [parseInt(total, 10), parseInt(active, 10)];
```
- **Pros:** Defensive, idiomatic TypeScript, zero runtime cost
- **Cons:** None
- **Effort:** Small
- **Risk:** None

## Recommended Action

Option A

## Technical Details

- **Affected files:** `src/modules/backoffice/missions/repositories/mission.repository.ts`

## Acceptance Criteria

- [x] `result!` replaced with nullish coalescing fallback
- [x] Unit tests still pass (164/164)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-03 | Created from PR #8 review | COUNT(*) without GROUP BY always returns a row in PG, but TS type system doesn't know that |
| 2026-06-03 | Fixed: replaced `result!` with `result?.total ?? '0'` pattern | Nullish coalescing is idiomatic for getRawOne fallbacks |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/8
