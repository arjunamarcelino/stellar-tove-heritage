---
status: complete
priority: p3
issue_id: 281
tags: [code-review, architecture, TOV-153, PR-38]
dependencies: []
---

# HTTP-status semantics now live in the neutral offerings domain helper

## Problem Statement
`offering-planning.helpers.ts` (`assertBandValid`, `resolveOfferableFloat`) throws `failHttp(...)` with
concrete `HttpStatus` codes. `modules/offerings/` is documented as a neutral, provider-only domain, so
it now carries request/HTTP-layer coupling. It is consistent with the repo's broad "`failHttp` in
services" convention and is only consumed by HTTP surfaces today, so **no action is required now**. The
latent concern: if a future M05 open/settle worker (e.g. a BullMQ processor with no HTTP context) needs
float resolution, it would inherit HTTP-status semantics it shouldn't.

## Findings
- **architecture-strategist (P3):** "if a non-HTTP consumer … ever needs float resolution, it would
  inherit HTTP-status semantics it shouldn't. If that materializes, split a pure
  `computeOfferableFloat`/`validateBand` (throwing domain errors) from a thin HTTP-mapping wrapper. No
  change needed now."
- Evidence: `src/modules/offerings/offering-planning.helpers.ts:19,33` (the `failHttp` throws).

## Proposed Solutions
### Option A — Defer (accept as-is; revisit when a non-HTTP consumer appears)
- **Pros:** no speculative refactor; matches current codebase convention. **Cons:** a future worker
  would need the split then. **Effort:** None. **Risk:** None today.

### Option B — Pre-emptively split pure domain logic from HTTP mapping
- Pure `computeOfferableFloat` / `validateBand` throwing domain errors + a thin HTTP wrapper the
  services call. **Pros:** clean layering ahead of M05. **Cons:** speculative (YAGNI) until a second
  consumer exists. **Effort:** Medium. **Risk:** Low.

## Recommended Action
**Option A — defer (chosen; confirmed by user 2026-08-19).** No code change.

## Resolution
Kept `offering-planning.helpers.ts` throwing `failHttp(...)` as-is — it matches the repo-wide
"`failHttp` in services" convention and every consumer today is an HTTP surface (the POST service and
the preview method). Pre-emptively splitting a pure `computeOfferableFloat`/`validateBand` from an HTTP
wrapper would be speculative (YAGNI) with only one consumer shape. **Action for the future:** when the
M05 open/settle FR adds a non-HTTP consumer (e.g. a BullMQ worker) that needs float resolution, split
the pure domain logic then and have the HTTP surfaces map domain errors → `failHttp`. This todo records
that decision; no change in this PR.

## Technical Details
- `src/modules/offerings/offering-planning.helpers.ts`

## Acceptance Criteria
- [ ] Decision recorded (defer vs split). If split: services map domain errors → `failHttp`; behavior
      unchanged; tests green.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38), architecture P3. Informational / future-proofing.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
