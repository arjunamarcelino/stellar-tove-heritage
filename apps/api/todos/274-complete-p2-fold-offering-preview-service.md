---
status: complete
priority: p2
issue_id: 274
tags: [code-review, architecture, simplicity, TOV-153, PR-38]
dependencies: []
---

# Consider folding `OfferingPreviewService` into `BackofficeArtworksService`

## Problem Statement
The preview endpoint is backed by a standalone `OfferingPreviewService` that injects
`ARTWORK_REPOSITORY` + `FRACTION_CONTRACT_REPOSITORY` — the **exact two repositories
`BackofficeArtworksService` already injects**. The service is a 48-line stateless read whose whole
body (validate band → find artwork → `resolveOfferableFloat` → `build`) is the same shape as the
existing `getArtwork` read on `BackofficeArtworksService`. Folding `preview()` in as a method would
delete a provider, its module registration, the duplicate DI, and the controller's second constructor
arg — with zero new dependencies.

This was a **deliberate decision at plan time** (keep the service separate = an all-new, zero-contention
file that maximized parallel-worktree implementation). Now that the code is committed, that
parallelism benefit is spent, so the trade-off is worth re-evaluating for maintenance.

## Findings
- **code-simplicity-reviewer (P2):** "Separate `OfferingPreviewService` is avoidable indirection …
  the host service already holds both repos … it already owns `getArtwork`/`listArtworks`, so it is
  already a mixed read+write service — the separation buys little here."
- **architecture-strategist (P3, defensible):** placement is fine; RouterModule forces the route onto
  `BackofficeArtworksController`, but the calculator could equally be a method on the artworks service.
- Evidence: `src/modules/backoffice/artworks/offering-preview.service.ts:24-27` injects the same repos
  as `backoffice-artworks.service.ts:48-49`.

## Proposed Solutions
### Option A — Fold `preview()` into `BackofficeArtworksService` (remove the standalone service)
- Move the method + delete the provider from `backoffice-artworks.module.ts`; controller injects only
  `BackofficeArtworksService`; update `offering-preview.service.spec.ts` to instantiate the host service.
- **Pros:** fewer moving parts; one read home; no duplicate DI. **Cons:** grows an already-large
  write-orchestrator service; a small spec rewrite. **Effort:** Small. **Risk:** Low (behavior identical).

### Option B — Keep as-is (status quo)
- **Pros:** cohesion — the fractionalize orchestrator (idempotency/audit/queue) stays uncluttered by a
  read calculator; unit test is isolated. **Cons:** the indirection the reviewer flags. **Effort:** None.

### Option C — Keep separate but relocate under `backoffice/offerings/`
- **Pros:** puts offering-domain calc in the offerings surface. **Cons:** splits the `/artworks/:id/*`
  route tree's backing services across modules; more wiring. **Effort:** Medium. **Risk:** Low.

## Recommended Action
**Option A — folded (chosen; confirmed by user 2026-08-19).**

## Resolution
`OfferingPreviewService` removed; `preview()` is now `BackofficeArtworksService.offeringPreview(...)`
(the host service already injected `ARTWORK_REPOSITORY` + `FRACTION_CONTRACT_REPOSITORY`). Deleted the
provider from `backoffice-artworks.module.ts`, dropped the controller's second constructor injection
(`this.service.offeringPreview(...)`), and reinstantiated the host service in the preview unit spec
(8 positional stubs, only artwork+contract exercised). Behavior identical. Verified: `nest build` 0
issues, lint clean, preview unit spec (10) + read spec (11) + preview e2e (10) all green.

## Technical Details
- `src/modules/backoffice/artworks/offering-preview.service.ts`
- `src/modules/backoffice/artworks/backoffice-artworks.controller.ts:54-57`
- `src/modules/backoffice/artworks/backoffice-artworks.module.ts` (providers/imports)
- `test/unit/modules/fractionalization/offering-preview.service.spec.ts`

## Acceptance Criteria
- [ ] Decision recorded (fold / keep / relocate).
- [ ] If folded: build + lint + unit/e2e green; controller injects one service; provider removed.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38). Pending triage. Note: separation was an intentional
  plan-time choice for parallel implementation; re-evaluate now that that benefit is realized.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
- Plan: `docs/plans/2026-08-19-feat-offering-planning-preview-and-embed-plan.md` (Enhancement Summary #4)
