---
status: complete
priority: p3
issue_id: 405
tags: [code-review, tov-191, pr-51, typescript, quality, tests]
dependencies: []
---
# TypeScript & test nits (decorative brand, misnomer, readonly, redundant test)

## Resolution (2026-08-24)
1. **Dropped the decorative `OpaqueCursor` brand** — `encodeCursor` now returns `string`; the cast is gone. It was write-only (never required as an input type), so it bought nothing.
2. **Fixed the "discriminated" misnomer** — the `TimelineEventData` docstring now correctly describes a structural union (no discriminant) and names the real PII protections (fixed-typed emit inputs + read-side allowlist + excess-property checks).
3. **Added `readonly`** to `TimelineEventRecord`, `TimelinePage` (`events`/`hasMore`), and the raw `TimelineEventRow` projection.
4. **Added a load-bearing-annotation comment** on `capturedTxHash` so a future editor doesn't collapse `: string | null` to `= null` (closure-only assignment).
5. **Made the near-redundant integration test meaningful** — it now does a real `encodeCursor → decodeCursor` round-trip and feeds the DECODED position back into `repo.page` (previously it encoded, asserted truthy, then ignored it and used a hand-built object).

**Left deliberately (harmless, forward-looking):** the `Record<string, never>` union member (documents the `{}` shape for schema-only types) and `tierForEventType` (used by the drift test; keeps tier-derivation co-located with the constant). Flagged in the review but not worth removing.
- Files: `timeline-cursor.ts`, `types/timeline-event-data.ts`, `repositories/timeline-read-repository.interface.ts`, `repositories/timeline-read.repository.ts`, `fraction-deploy.processor.ts`, `test/integration/modules/timeline/timeline-read.integration.spec.ts`.
- Verified: build + lint green; timeline unit + integration pass.

## Problem Statement
A cluster of low-value cleanups surfaced across the TypeScript and simplicity reviews. None affect correctness; each is optional.

## Findings
1. **`OpaqueCursor` brand is write-only / decorative.** `timeline-cursor.ts:14,49` — `encodeCursor` returns `OpaqueCursor`, but the only consumer widens it to `string` (`nextCursor: string | null`), and `decodeCursor` takes a plain `string`. The brand is never required as an input type anywhere, so it enforces nothing. Either make `decodeCursor`'s param / the DTO field `OpaqueCursor` (load-bearing), or drop the brand and return `string`.
2. **`TimelineEventData` labelled "discriminated" but has no discriminant.** `types/timeline-event-data.ts:1,22-25` — it's a plain structural union with no shared tag; you can't `switch`/narrow it. The PII protection actually comes from the fixed-typed emit inputs + the read-side allowlist (both sound). Fix the comment/name so the next writer isn't misled. (The excess-property check on literal assignment does still help.)
3. **Read-model shapes could be `readonly`.** `repositories/timeline-read-repository.interface.ts:8-15,24-28` (`TimelineEventRecord`, `TimelinePage.events`) and `timeline-read.repository.ts:13-20` (`TimelineEventRow`) are mutable projections never mutated post-construction. `TimelineResponseDto.build` already takes `readonly TimelineEventRecord[]` — make the element fields `readonly` to round it out.
4. **`capturedTxHash` annotation is load-bearing-but-fragile.** `fraction-deploy.processor.ts` — `let capturedTxHash: string | null = null` is assigned only inside the `onTxHash` closure; if someone "tidies" it to `let capturedTxHash = null`, the inferred type collapses to `null` and it breaks. No change needed — add a one-line comment so a future editor doesn't simplify it.
5. **Unused union member + test-only helper.** `types/timeline-event-data.ts:22-25` — the `Record<string, never>` member is never constructed (forward-looking only). `constants/timeline-event.constant.ts:53-55` — `tierForEventType` is consumed only by the integration drift test. Both harmless; flagged for completeness.
6. **Decorative `encodeCursor` in the read integration spec.** `timeline-read.integration.spec.ts:105-123` encodes a cursor, asserts it truthy, then **ignores it** and passes the raw `{occurredAtMs,id}` position to `repo.page`. The claimed round-trip is never fed back into the read path, and the no-overlap continuation is already covered by the multi-page walk above it and the e2e HTTP walk (which does round-trip the real `nextCursor`). Near-redundant; either make it actually decode the encoded cursor or drop it.

## Proposed Solutions
### Option A — Apply the cheap wins, leave convention-bound items conscious (Recommended)
Do 2 (fix comment), 3 (add `readonly`), 4 (add comment), and either enforce or drop 1 (brand). Leave 5 (forward-looking, harmless) and decide 6 (make the test meaningful vs delete).
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `timeline-cursor.ts`, `types/timeline-event-data.ts`, `repositories/timeline-read-repository.interface.ts`, `timeline-read.repository.ts`, `fraction-deploy.processor.ts`, `test/integration/modules/timeline/timeline-read.integration.spec.ts`.

## Acceptance Criteria
- [ ] Each nit is either applied or consciously declined with a reason.

## Work Log
- 2026-08-24: Filed from PR #51 review (kieran-typescript + code-simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
