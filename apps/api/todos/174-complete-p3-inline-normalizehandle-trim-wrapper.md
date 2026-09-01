---
status: complete
priority: p3
issue_id: 174
tags: [code-review, simplicity, quality, handle, TOV-26]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Removed the `normalizeHandle` export from `handle-format.ts` and inlined
`const handle = raw.trim();` (with a "trim ends only" comment) at both call sites in `HandleService`
(`check`, `setHandle`); dropped its import. Removed the now-dead `normalizeHandle` describe block from
the unit spec — the trim behavior stays covered by e2e AC11 (`"  maya  "` → stored `maya`). No hidden
"normalize" abstraction remains for what is literally `.trim()`. Build clean; handle unit (8) green.

# `normalizeHandle()` is a one-line `.trim()` wrapper (optional inline)

## Problem Statement
`normalizeHandle` is an exported function whose entire body is `return raw.trim();`. It is called only
twice, both inside `HandleService` (same file's collaborator). A named "normalize" function implies
domain normalization semantics (case-folding, NFC, separator collapsing) that don't exist — it's
literally `.trim()`. Inlining `const handle = raw.trim();` at the two call sites removes an export and a
test-surface symbol without losing meaning.

This is a genuine judgment call, not a defect. The only argument to keep it is "a future normalization
step has one home" — which is the YAGNI trap unless such a step is actually planned.

## Findings
- `src/modules/users/handle/handle-format.ts:12-14` — `normalizeHandle` = `raw.trim()`.
- `src/modules/users/handle/handle.service.ts:23,32` — the only two call sites.

## Proposed Solutions
### Option A: Inline `.trim()` at both call sites
- **Pros:** ~3 LOC + 1 export removed; no hidden "normalize" abstraction. **Cons:** if a real normalization
  step is added later, it has no single home. **Effort: Small.**

### Option B: Keep it
- **Pros:** single seam if normalization grows (e.g. NFC). **Cons:** implies semantics that don't exist.
  **Effort: None.**

## Recommended Action
_(triage — cosmetic; keep if a richer normalization is foreseen, else inline.)_

## Technical Details
- Files: `src/modules/users/handle/handle-format.ts`, `handle.service.ts` (+ its unit test if the export is removed).

## Acceptance Criteria
- [ ] Decision recorded; if inlined, `normalizeHandle` export removed and call sites use `.trim()` directly.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #28 (code-simplicity-reviewer). Only actionable simplicity
  item found; the 5 DTOs, the not-found branch, and the boolean repo return are all justified.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/28
