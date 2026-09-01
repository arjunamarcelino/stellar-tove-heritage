---
status: complete
priority: p3
issue_id: 282
tags: [code-review, api-design, frontend-contract, TOV-153, PR-38]
dependencies: []
---

# Confirm DTO field breadth + preview's active-offering signal against real frontend needs

## Problem Statement
Two related "confirm against the UI" questions, neither a defect:

1. **`OfferingSummaryDto` field breadth.** The embed exposes
   `{ id, status, lowPriceStroops, highPriceStroops, publicFloat, windowOpenAt, windowCloseAt }`, yet its
   docstring says the UI "gates the Plan-Offering CTA on this being `null`." If the *only* consumer is a
   null-gate, the money/window fields are over-fetching (a boolean would do). They are appropriate **if**
   the detail view actually renders the pending-offering terms. Same, lower-stakes, for
   `OfferingPreviewDto`'s echoed `lowPriceStroops`/`highPriceStroops` (pure echo of caller input).
   _(Note: the core-set fields were a deliberate brainstorm decision confirmed with the product owner;
   this todo is to re-confirm against the actual rendered card, not to assume.)_

2. **Preview does not signal an already-active offering.** `preview()` intentionally does not gate on an
   existing active offering, so it can return a fully "valid" preview for an artwork whose subsequent
   `POST /offerings` would 409 on the unique index. This is documented and by-design (the embed /
   POST-index own existence-gating), but the UI must gate the form on `GET /artworks/:id →
   activeOffering === null` to avoid a dead-end. Worth confirming the frontend does so.

## Findings
- **code-simplicity-reviewer (P3):** "If the sole consumer is a null-gate, the money/window fields are
  speculative … Worth confirming against the real front-end need rather than assuming."
- **data-integrity-guardian (P3, UX):** "preview does not gate on an already-active offering … can
  return a fully 'valid' preview for an artwork whose subsequent POST would 409 … flagging only for
  visibility."
- Evidence: `dto/offering-summary.dto.ts`, `dto/offering-preview.dto.ts:23-28`,
  `offering-preview.service.ts` (no active-offering gate, documented).

## Proposed Solutions
### Option A — Confirm the Admin Console's plan-form + detail-card contract, then keep/trim accordingly
- Verify (a) the detail card renders the offering terms (→ keep the summary fields) or only gates the
  CTA (→ could trim to `{id, status}`); (b) the form gates on `activeOffering === null` before allowing
  a plan. Record the confirmation; trim only if genuinely unused.
- **Pros:** contract matches real need. **Cons:** requires a frontend/product check. **Effort:** Small
  (coordination). **Risk:** Low.

### Option B — Keep as-is (fields + stateless preview), document the UI gating requirement
- **Pros:** no change; richer contract is future-proof. **Cons:** possible over-fetch if unused.
  **Effort:** Trivial. **Risk:** None (backend correct either way).

## Recommended Action
**Keep as designed (chosen); no backend change.**

## Resolution
1. **DTO field breadth — kept.** `OfferingSummaryDto`'s `{ band, publicFloat, window }` were a
   deliberate brainstorm decision confirmed with the product owner (the detail card renders the pending
   offering's terms, not just a null-gate), so they are not speculative. `OfferingPreviewDto`'s echoed
   band mirrors the caller input for a self-contained preview response. No trim.
2. **Preview non-gating — kept, by design.** The preview stays a stateless calculator; existence-gating
   is owned by the `activeOffering` embed (`GET /artworks/:id`) + the POST unique index. This is
   documented in `offering-preview.service` / `BackofficeArtworksService.offeringPreview`. **Frontend
   responsibility (documented in the brainstorm/plan, not a backend change):** the Admin Console must
   gate the Plan-Offering form on `GET /artworks/:id → activeOffering === null` so a preview never leads
   to a dead-end 409 on submit. The backend contract already supports that gate.

No code change in this PR; decision recorded for the frontend integration.

## Technical Details
- `src/modules/backoffice/artworks/dto/offering-summary.dto.ts`
- `src/modules/backoffice/artworks/dto/offering-preview.dto.ts`
- `src/modules/backoffice/artworks/offering-preview.service.ts`

## Acceptance Criteria
- [ ] Frontend contract confirmed: summary fields are rendered (or trimmed), and the plan form gates on
      `activeOffering === null`.

## Work Log
- 2026-08-19 — Raised by code-review (PR #38), simplicity + data-integrity P3. Backend is correct; this
  is a contract-confirmation item with the UI team.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/38
- Brainstorm: `docs/brainstorms/2026-08-19-tov153-offering-planning-ui-backend-support-brainstorm.md`
