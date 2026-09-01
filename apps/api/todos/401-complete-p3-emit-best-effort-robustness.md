---
status: complete
priority: p3
issue_id: 401
tags: [code-review, tov-191, pr-51, reliability, emit, bullmq]
dependencies: []
---
# Emit "best-effort, never throws" contract has two holes (resolve outside try; deploy emit inside try)

## Resolution (2026-08-24) — Option A
**Hole 1:** wrapped `TimelineEmitService.resolveArtworkId` in a try/catch (log + return null), so a transient DB error in the `fraction_contracts` lookup can no longer propagate out of `emitSecondaryTradeSettled` → post-commit `persistSettled` and spuriously fail/retry an already-settled trade. The service now genuinely never throws.

**Hole 2:** moved the fractionalization emit **outside** the deploy `try/catch` in `FractionDeployProcessor.process` (captured `deployed = {tokenAddress, deployLedger}` inside the try, emit after). A timeline emit can no longer land in the `catch` → `latchFailed` → `UnrecoverableError` path and misclassify an already-latched successful deploy as failed. Now consistent with the settle worker's outside-the-try placement.
- Files: `src/modules/timeline/timeline-emit.service.ts`, `src/modules/fractionalization/deploy/fraction-deploy.processor.ts`.
- Verified: build green; fractionalization unit 71/71, timeline+fractionalization+marketplace integration 79/79 pass.

## Problem Statement
`TimelineEmitService` documents that "a failed emit is LOGGED, never thrown." Two call sites don't fully honor it. Neither is money-unsafe (both self-heal idempotently), but both can spuriously fail/retry a BullMQ job and one can misclassify a success.

**Hole 1 — `resolveArtworkId` is outside the best-effort try/catch.** `emitSecondaryTradeSettled` calls `resolveArtworkId()` (a raw `SELECT ... FROM fraction_contracts`) *before* the guarded `insert()`. A transient DB error there propagates out of `emitSecondaryTradeSettled` → `SettlePersistenceService.persistSettled` (which awaits it **post-commit**). The settlement is already committed (safe), but the settle job is needlessly marked failed and retried. The `insert` path is guarded; the pre-insert read is not. (security-sentinel P3, architecture LOW.)

**Hole 2 — the fractionalization emit sits *inside* the deploy `try`.** In `FractionDeployProcessor.process`, the emit is placed after `latchDeployed` (already committed) but still inside the `try`. It relies entirely on `insert`'s internal try/catch never throwing. Today nothing pre-`insert` throws on that path, so it can't — but *if* it ever did, the `catch` would run `latchFailed` (a safe no-op now, since both CAS return `won=false` on an already-`deployed` row) and then throw `UnrecoverableError`, marking a **successful** deploy job as failed. Latent misclassification, and inconsistent with the settle path which deliberately emits *outside* any try. (architecture LOW.)

## Findings
- `src/modules/timeline/timeline-emit.service.ts:64` — `resolveArtworkId` outside the `try` at `:95-110`.
- `src/modules/marketplace/settlement/settle/settle-persistence.service.ts:83` — awaits emit post-commit (correct placement; the throw originates in the service).
- `src/modules/fractionalization/deploy/fraction-deploy.processor.ts:~98-104` — emit inside the `try`; `catch` at `:105` runs `latchFailed` + throws `UnrecoverableError`.

## Proposed Solutions
### Option A — Make the emit service truly non-throwing + move the deploy emit outside the try (Recommended)
Wrap the whole `emitSecondaryTradeSettled` body (or at least `resolveArtworkId`) in the same log-not-throw catch; move the fractionalization emit below the deploy `try/catch` (post-latch, unguarded, mirroring the settle worker). Makes both workers consistent and the docstring true.
- Pros: removes spurious retries + the misclassification path; consistent. Cons: two small edits across two domains.
- Effort: Small · Risk: Low.

### Option B — Only fix Hole 1 (wrap `resolveArtworkId`)
The deploy path can't throw today, so leave it. Minimal.
- Pros: smallest. Cons: leaves the latent misclassification + the worker-to-worker inconsistency.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `timeline-emit.service.ts`, `fraction-deploy.processor.ts`.
- Add a test: force `resolveArtworkId` / the deploy emit to throw → the settle/deploy job outcome is unaffected (no rethrow).

## Acceptance Criteria
- [ ] `emitSecondaryTradeSettled` never throws for any DB error (resolve or insert).
- [ ] The fractionalization emit can never cause a succeeded deploy to be latched failed.
- [ ] Both workers place the emit consistently relative to their try/catch.

## Work Log
- 2026-08-24: Filed from PR #51 review (security-sentinel + architecture-strategist).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
