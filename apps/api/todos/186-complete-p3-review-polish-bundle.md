---
status: complete
priority: p3
issue_id: 186
tags: [code-review, quality, polish, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied items 1–3; item 4 intentionally deferred.
1. Added the `repository.update` hook-bypass rationale comment to `UserRepository.setHistoryVisibility`
   (parity with `setHandle`) so it isn't "fixed" into `this.update()`/`save()`.
2. Added the "`yarn migration:generate` reports drift here — discard; don't add generatedType/asExpression"
   note to `HandleHistory.handleCanonical` (parity with `User.handleCanonical`).
3. Precompiled the redact regex once per key in a module-level `Map` (the pino serializer runs it per
   request); a `/g` regex reused across `.replace()` is safe. Existing redact unit tests still green.
4. NOT done (deferred): running `isValidHandleFormat` on `:handle` for a uniform 404. It would conflict with
   todo 183's `MAX_HANDLE_LENGTH` short-circuit and change the not-found semantics (malformed handles would
   skip the DB); the length short-circuit already bounds the cheap-miss case, and the 404 body is already
   identical across old/unknown/over-length. Left as an optional future hardening.
Build clean; redact unit (9) green.

# Minor polish bundle from PR #29 review (4 one-liners)

## Problem Statement
Four small consistency/polish nits surfaced by the review, grouped since each is a one-liner:

1. `setHistoryVisibility` lacks the hook-bypass rationale comment that `setHandle` has — a reader might
   "fix" it to `this.update()` (which runs hooks).
2. `HandleHistory.handleCanonical` lacks the "`yarn migration:generate` will report drift here — discard
   that diff" note that `User.handleCanonical` carries; a dev could "fix" the false-positive
   generated-column drift and break inserts.
3. `redactUrlQueryParams` builds a fresh `RegExp` per key per request inside the pino serializer hot path
   — hoist/precompile to module scope (no ReDoS; micro-opt, worthwhile only if the key list grows).
4. `:handle` over-length short-circuits without a DB hit while a valid-length miss queries the DB — a
   minor timing side channel; optionally run `isValidHandleFormat` and return a uniform 404 for all
   non-conforming input (also saves a DB round-trip on garbage).

## Findings
- `src/modules/users/repositories/user.repository.ts:55` — `setHistoryVisibility` (no comment).
- `src/modules/users/entities/handle-history.entity.ts:22-27` — missing generated-column drift note (cf. `user.entity.ts:32-34`).
- `src/common/logging/redact-query.util.ts:20` + `src/app.module.ts:81-86` — per-request `RegExp` construction.
- `src/modules/collectors/collectors.service.ts:26-38` — over-length short-circuit vs valid-length DB query.

## Proposed Solutions
### Option A: Apply the four independent one-liner/small fixes opportunistically
- **Pros:** comments 1-2 are free; regex hoist is a clean micro-opt; uniform 404 closes a minor side
  channel and saves a DB round-trip. **Cons:** each is low-value in isolation. **Effort: Small each.**
- Add two comments; hoist the regex to module scope; optionally add the format-validate uniform-404.

## Recommended Action
_(triage — low priority; apply opportunistically (comments 1-2 are free).)_

## Technical Details
- Files: `user.repository.ts`, `handle-history.entity.ts`, `redact-query.util.ts`, `app.module.ts`, `collectors.service.ts`.

## Acceptance Criteria
- [x] Rationale comments added (setHistoryVisibility hook-bypass + entity generated-column drift); redact regex precompiled. Uniform-404-for-malformed `:handle` deferred (would conflict with 183; see resolution).

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (kieran-typescript-reviewer / data-integrity-guardian / performance-oracle / security-sentinel).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
