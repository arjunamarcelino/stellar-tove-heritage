---
status: complete
priority: p3
issue_id: 335
tags: [code-review, quality, tov-160]
dependencies: []
---
# Pattern-consistency polish: idempotency-ordering divergence, duplicated sanitizeReason, 503-vs-409 for a pure-DB precondition

## Problem Statement
Three pattern-consistency observations across the TOV-160 settle path. Each is minor and none is a correctness bug, but they make the two escrow producers and three processors read less uniformly than they should, and one HTTP status choice is arguably semantically off.

## Findings
- **(1) IDEMPOTENCY-ORDERING DIVERGENCE** — `src/modules/backoffice/offerings/backoffice-offerings.service.ts` `settle()` wraps `idempotency.complete()` in a `.catch(warn)` (more robust — a `complete()` blip no longer skips the enqueue), but `approve()` does **not** wrap it. Both honor the money-safety rule (no `fail()` after commit), so neither is buggy — but the two producers should read identically. Backport the `.catch(warn)` wrapper to `approve()`.
- **(2) DUPLICATED `sanitizeReason`** — `src/modules/offerings/offering-settle.processor.ts` `sanitizeReason` is byte-identical to `src/modules/offerings/deploy/offering-escrow-deploy.processor.ts`'s copy, and `src/modules/offerings/bids/escrow/offering-bid-escrow.processor.ts` carries a **third**, divergent variant (reason-only). Rule-of-three is met → extract to a shared helper (e.g. `src/modules/offerings/escrow/sanitize-reason.ts`) that all three import, or document why the bid variant intentionally differs.
- **(3) `OFFERING_ESCROW_UNAVAILABLE` 503 for a pure-DB precondition** — `settle()` returns 503 when `escrow_deploy_status !== 'deployed'`. That is a stable precondition: a client retry won't help unless the deploy independently completes, so it reads more like **409 Conflict** than 503 "try again later." Either switch to 409 or add a comment justifying the 503 (i.e. the mid-deploy retry semantics that make "try later" defensible).

## Proposed Solutions
### Option A — Address all three
- Description: Add `.catch(warn)` to `approve()`; extract a shared `sanitizeReason` helper (documenting the bid variant's divergence or unifying it); change the precondition status to 409 (or add the justifying comment).
- Pros: The two producers and the processors read identically; the status code matches semantics.
- Cons: Touching the 503→409 status is a (minor) API-contract change the FE may key on; needs coordination.
- Effort: Small
- Risk: Low

### Option B — Do (1) and (2), leave the 503 with a justifying comment
- Description: Unify the idempotency wrapper and the sanitize helper; keep 503 but add a comment explaining the mid-deploy retry semantics.
- Pros: No API-contract change; removes the duplication and the producer asymmetry.
- Cons: The status-code semantics stay slightly off.
- Effort: Small
- Risk: Low

## Recommended Action
Option B — backport the `.catch(warn)` to `approve()` and extract the shared `sanitizeReason` helper (documenting the bid-variant divergence), and keep the 503 but add a comment justifying it via mid-deploy retry semantics (avoids an FE-visible contract change). Revisit 409 only if the FE confirms it does not distinguish 503 here.

## Technical Details
- The money-safety invariant both producers already satisfy: never call `idempotency.fail()` after the DB commit, so a post-commit idempotency error cannot roll the write back or double-charge.
- The bid-escrow `sanitizeReason` variant is reason-only (no code prefix) — if unified, preserve that call site's output or intentionally change it with a note.

## Acceptance Criteria
- `approve()` and `settle()` handle `idempotency.complete()` failure identically.
- A single `sanitizeReason` helper is imported by all three processors, or the divergence is documented at each call site.
- The precondition response either uses 409 or carries a comment justifying the 503.

## Work Log
- 2026-08-20: created from PR #43 review (pattern-recognition-specialist)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
This grouped todo bundled three pattern items. Applied the one that was a decision (`OFFERING_ESCROW_UNAVAILABLE`
503 → **409**, per the review-fix confirmation): escrow-not-deployed is a stable precondition (a client retry
won't help until the deploy completes), so 409 fits the surrounding state gates. Updated the throw, the enum
comment, and settle-service U13g (now asserts status 409). Also applied (a) backported the `.catch(warn)` on `idempotency.complete()` to `approve()` so the two producers
read identically, and (b) extracted the duplicated `sanitizeReason` into `src/modules/offerings/sanitize-reason.ts`
imported by both the deploy + settle processors (removed both local copies). The bid-escrow processor keeps its
divergent reason-only variant by design. Build green; deploy/approve/settle specs 36/36.
