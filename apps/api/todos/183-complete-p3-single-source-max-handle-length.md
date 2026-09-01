---
status: complete
priority: p3
issue_id: 183
tags: [code-review, quality, consistency, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Exported `MIN_HANDLE_LENGTH`/`MAX_HANDLE_LENGTH` from `handle-format.ts` (the single source for handle
rules) and used them in `isValidHandleFormat`. `CollectorsService` now imports `MAX_HANDLE_LENGTH` instead of
a local `const … = 24`, so the length cap has one source — a future cap change can no longer silently 404
valid handles in the collectors short-circuit. Ported the load-bearing rationale comment to `getProfile`:
"JS toLowerCase() agrees with Postgres lower() because stored handles are ASCII (format-validated on write)".
Did NOT introduce a `canonicalizeHandle()` helper (would re-litigate the deliberate TOV-26 #174 inlining
decision). Build clean; handle + collectors unit (20) + collectors e2e (9) green.

# MAX_HANDLE_LENGTH (24) re-declared in collectors; canonicalization rationale comment dropped

## Problem Statement
`MAX_HANDLE_LENGTH = 24` is redeclared in `collectors.service.ts`, duplicating the length rule in
`handle-format.ts` and the `varchar(24)` columns on `User.handle` + `HandleHistory.handle` (4 copies of
the same value). If the cap ever changes, the collectors short-circuit silently 404s valid handles.

Also, `collectors.service.getProfile` canonicalizes with `trim().toLowerCase()` but drops the
load-bearing "ASCII ⇒ agrees with Postgres lower()" rationale comment that TOV-26's handle service
carries — and the collectors read path relies on that exact equivalence (it feeds
`findByHandleCanonical`).

NOTE: a shared `canonicalizeHandle()` helper is NOT warranted (that would re-litigate the deliberate
TOV-26 #174 inlining decision); only export the constant + port the comment.

## Findings
- `src/modules/collectors/collectors.service.ts:13` — local `MAX_HANDLE_LENGTH`.
- `src/modules/collectors/collectors.service.ts:26` — canonicalization without the rationale comment.
- `src/modules/users/handle/handle-format.ts:27` — the length rule + ASCII comment (single source).

## Proposed Solutions
### Option A: Export the constant; import it; port the comment
- **Pros:** single source for 24; collectors carries the ASCII/lower() rationale; no new abstraction.
  **Cons:** none material. **Effort: Small.**
- Export `MAX_HANDLE_LENGTH` from `handle-format.ts`; import it in `collectors.service.ts`. Port the
  "ASCII ⇒ agrees with Postgres lower()" rationale comment to `getProfile`. Do NOT introduce a
  `canonicalizeHandle()` wrapper.

## Recommended Action
_(triage — Option A.)_

## Technical Details
- Files: `handle-format.ts`, `collectors.service.ts`.

## Acceptance Criteria
- [x] Single source for the 24 constant (`MAX_HANDLE_LENGTH` exported from `handle-format.ts`); collectors carries the ASCII/lower() rationale comment; no `canonicalize()` wrapper introduced.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (kieran-typescript-reviewer / architecture-strategist / pattern-recognition-specialist).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
