---
status: complete
priority: p3
issue_id: 398
tags: [code-review, tov-189, pr-50, simplification, quality, tests]
dependencies: []
---
# Simplification & test nits (redundant guard, defensive helper, brittle tests, DI token)

## Problem Statement
Small quality/simplicity items. Each is optional; several intersect a deliberate house convention, so
they should be conscious decisions, not reflexive edits.

## Findings
1. **`MAX_ID_LENGTH` length guard is redundant with `isUUID`.** `artworks.service.ts:20,45`
   (`id.length <= MAX_ID_LENGTH && isUUID(id)`). `isUUID` already returns false for any non-36-char
   string; class-validator's regex is anchored/linear (no ReDoS) and path params are transport-bounded.
   Proof it's behaviorally dead: the oversized-id test (`artworks.service.spec.ts:107-110`) still passes
   with the length check removed. → Reduce to `const valid = isUUID(id);`, delete the const + comment (or
   keep the test as an `isUUID` case). ~7 lines. (Counter: defensible micro-hardening.) (simplicity)
2. **`assertVisibleStatus` is defensive-only.** `artwork-visibility.constant.ts:23-28`, called per row in
   `toRecord` (`artwork-read.repository.ts:73`). Both reads already filter `WHERE status IN (...)`, so it
   can only fire on schema drift; the simplest-correct form is a cast. **However** the codebase has an
   explicit, heavily-cited "guard over `as`-cast" convention (pr34/pr35) — if honored deliberately, keep
   it. Flagging so it's a conscious choice. (simplicity, low-confidence)
3. **Redundant per-status 200 test.** `artworks.service.spec.ts:74-84` — the verified and fractionalized
   200 tests exercise the identical service path (status is a pass-through); real per-status visibility
   lives in the repo/integration layer. Fold to one. (tests)
4. **Parallel-signing test asserts an implementation detail.** `artworks.service.spec.ts:166-181` — the
   `active/maxActive` counter asserts concurrency, an optimization not an observable contract; would fail
   if signing became sequential-but-fast despite identical output. Optional to drop (fail-open,
   ordering, timeout are covered elsewhere). (tests, brittle)
5. **Untyped string DI token `'IStorageService'`.** `artworks.service.ts:32` (`@Inject('IStorageService')`)
   — a typo is a runtime DI failure, not a compile error, and the annotated type is unverified against the
   token. This is **pre-existing house style** (`StorageModule` provides/exports the same magic string),
   so the PR is *consistent*, not newly wrong. Contrast this module's own exported `ARTWORK_READ_REPOSITORY`
   const. → Follow-up: export a shared `STORAGE_SERVICE` token const from the storage module (touches
   existing code, hence separate). (typescript, pre-existing)

## Proposed Solutions
### Option A — Apply the clear wins, leave convention-bound items conscious (Recommended)
- Do 3 (fold test) and, if desired, 1 (drop redundant guard) and 4 (drop brittle test). Leave 2
  (respect house convention) and 5 (pre-existing, codebase-wide follow-up) unless separately prioritized.
- Effort: Small · Risk: Low.

## Recommended Action
_(triage)_ — Option A. Note 5 is codebase-wide and out of this PR's scope; track separately if pursued.

## Technical Details
- Affected: `artworks.service.ts`, `artwork-visibility.constant.ts`,
  `test/unit/modules/artworks/artworks.service.spec.ts`, (follow-up) `storage.module.ts`.

## Acceptance Criteria
- [ ] Decision recorded for the `MAX_ID_LENGTH` guard (keep as hardening / remove as dead).
- [ ] Redundant per-status 200 test folded; parallel-signing test kept-or-dropped consciously.
- [ ] `assertVisibleStatus` kept per convention or replaced — a conscious call.
- [ ] (Follow-up) shared `STORAGE_SERVICE` token const decision recorded.

## Resolution (2026-08-24, complete)
1. **`MAX_ID_LENGTH`** — REMOVED (const + comment); the guard is now `isUUID(id)` alone, which already
   rejects any malformed/oversized id before it reaches the uuid column. The oversized-id unit test is
   kept (it now documents `isUUID` rejecting 129-char input without a repo hit).
2. **`assertVisibleStatus`** — KEPT per the pr34/pr35 "guard over `as`-cast" house convention (conscious choice).
3. **Redundant per-status 200 test** — folded the verified + fractionalized 200 tests into one
   status-passthrough test (per-status visibility is covered at the repo/integration layer).
4. **Brittle parallel-signing test** — DROPPED (asserted an implementation detail; fail-open, ordering,
   and timeout remain covered).
5. **Untyped `'IStorageService'` token** — DEFERRED: pre-existing, codebase-wide house style (StorageModule
   itself uses the magic string); a shared `STORAGE_SERVICE` const is a separate cross-cutting follow-up,
   out of this PR's scope.

Net: artworks unit 21 → 19 (2 pruned). Verified: build 0, lint clean, unit 19/19.

## Work Log
- 2026-08-24: Filed from PR #50 review (code-simplicity P2/P3, kieran-ts P2 — grouped).
- 2026-08-24: Resolved — removed MAX_ID_LENGTH, folded/dropped two tests; kept assertVisibleStatus; DI token deferred. Complete.
