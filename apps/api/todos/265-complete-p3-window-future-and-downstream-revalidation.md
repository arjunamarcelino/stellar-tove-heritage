---
status: complete
priority: p3
issue_id: 265
tags: [code-review, correctness, M05, TOV-152, PR-36]
dependencies: []
---

# Window is not required to be in the future — confirm deferral + pin downstream re-validation

## Problem Statement
Validation enforces only `window_open_at < window_close_at`; nothing rejects a window entirely in the past. This is a deliberate FR-05.01 decision (planning only writes `planned`), but it means a retroactively/immediately-open offering can be created. The forward risk is that later M05 FRs (`open`/`settle`) must re-validate `window_*` against current time, or a stale/past-window offering could be opened or settled.

## Findings
Flagged by **security-sentinel (P3)**; also captured as a forward-note in the plan.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — window block checks `Number.isNaN || openMs >= closeMs`, no `Date.now()` comparison.
- DB `CHK_off_window` only enforces `window_close_at > window_open_at`.

## Proposed Solutions
1. **Keep as-is (deferred)** — add a one-line comment in the service/window block stating the "no must-be-future" rule is intentional for planning, and that `open`/`settle` FRs own the time-vs-now check. Effort: trivial. Matches the brainstorm decision.
2. Add a `closeMs <= Date.now()` (or `openMs < Date.now()`) → 422 check now, if product wants planning to reject already-expired windows. Effort: Small. Introduces a time-dependent rule (test-flakiness risk) — the reason it was deferred.

## Recommended Action
**RESOLVED — Solution 1 (keep deferred + document).** Added a comment at the window-validation site
stating the past-window allowance is an intentional FR-05.01 decision and that the M05 open/settle FRs
MUST re-validate `window_*` against `now`. No time-dependent rule added at planning (avoids test flakiness).
The plan's forward-notes already carry the downstream requirement.

## Technical Details
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts`.
- Forward dependency: M05 `open`/`settle` FRs must re-check `window_*` vs `now`.

## Acceptance Criteria
- [x] Deferral confirmed and commented at the validation site.
- [x] Downstream window-vs-now re-validation noted (comment + plan forward-notes) for the M05 open/settle FRs.

## Work Log
- 2026-08-18: created from PR #36 review (security-sentinel P3).
- 2026-08-18: RESOLVED — comment added at the window-validation block (`backoffice-offerings.service.ts`). Build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
