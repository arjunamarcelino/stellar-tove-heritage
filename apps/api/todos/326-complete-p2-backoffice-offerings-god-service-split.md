---
status: complete
priority: p2
issue_id: 326
tags: [code-review, architecture, tov-160]
dependencies: []
---
# `BackofficeOfferingsService` is a ~538-line god service spanning three feature epics with 10 deps and two BullMQ queues

## Problem Statement
`BackofficeOfferingsService` now spans three distinct feature epics behind a single injectable: TOV-152 planning (`create`), TOV-154 approval (`approve` / list / getOne), and TOV-160 clearing-preview + settle. It carries 10 constructor dependencies including TWO separate BullMQ producer queues (the escrow-deploy queue AND the settle queue), plus artwork/contract repos and the bid repo that only the settlement/preview methods use. At ~538 lines with `settle()` alone ~110 lines, it violates SRP at the service level, couples three unrelated lifecycles (plan → approve → settle) behind one class, and the seam will only worsen as the open/close FRs land. The service's own class docstring still describes it as "a pure DB write — no Soroban call, no BullMQ worker," which is no longer true now that approval and settlement have bolted on two queues.

## Findings
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — 538 lines (`wc -l`).
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:68-79` — 10 constructor deps: `offerings`, `approvals`, `bids`, `artworks`, `contracts`, `escrowCfg`, `deployQueue` (`OFFERING_ESCROW_DEPLOY_QUEUE`), `settleQueue` (`OFFERING_SETTLE_QUEUE`), `idempotency`, `audit`.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:75-76` — the two `@InjectQueue` producers (deploy for TOV-154, settle for TOV-160) living in one service.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:58-63` — the class docstring still says "pure DB write — no Soroban call, no BullMQ worker," contradicting the added approval/settle queue producers.
- The `OFFERING_BID_REPOSITORY` (`bids`) and `computeClearing`/`toClearingInput` imports (lines 37-38, 71) are used ONLY by the settlement/preview surface, not by plan or approve.

## Proposed Solutions
### Option A — Extract settlement into `BackofficeOfferingSettleService`
- Description: Move `previewClearing` + `settle` (and their private helpers) into a new `BackofficeOfferingSettleService` owning the `settleQueue` (`OFFERING_SETTLE_QUEUE`) and `OFFERING_BID_REPOSITORY`, leaving `BackofficeOfferingsService` for plan + approve (+ list/getOne). The controller injects BOTH services and routes each endpoint to the appropriate one — no route/path change, no DTO change.
- Pros: Each service owns one lifecycle + only the deps it uses (the settle service drops artwork/contract-planning coupling; the plan/approve service drops the bid repo + settle queue); `settle()`'s ~110 lines get room to breathe; the misleading "pure DB write" docstring becomes true for the reduced class; the open/close FRs have a clear home to grow into.
- Pros (cont'd): Smaller blast radius per change and easier-to-target unit tests per surface.
- Cons: One more provider + controller wiring; a little shared plumbing (idempotency/audit) is now injected into two services rather than one.
- Effort: Medium
- Risk: Low

### Option B — Leave as one service, split later
- Description: Accept the god service for now; revisit when the open/close FRs land and force the issue.
- Pros: Zero churn on a just-reviewed PR.
- Cons: The seam keeps accreting (open/close will add more queues/deps); every future offering FR compounds the SRP violation and the test surface; the stale docstring stays wrong.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — split the settlement surface (`previewClearing` + `settle`) into a `BackofficeOfferingSettleService` that owns the settle queue + `OFFERING_BID_REPOSITORY`, leaving `BackofficeOfferingsService` for plan/approve; the controller injects both, with no route change. Not blocking for merge, but do it before the open/close FRs pile onto the same class. Update the class docstring to match the reduced responsibility.

## Technical Details
The controller currently injects one service; after the split it injects two and dispatches per-endpoint — the `@Controller('offerings')` routes and DTOs are unchanged. The settle service takes `offerings` (for the CAS/status reads it shares), `bids`, `contracts`/`artworks` only if `previewClearing` needs them, `settleQueue`, `escrowCfg` (for `maxBidsPerOffering`), plus the shared `idempotency`/`audit`. Confirm no private helper is shared across the plan/approve and settle halves before moving it (if one is, promote it to a small shared helper module rather than duplicating). The neutral `OfferingsModule` provider wiring is unaffected; this is a backoffice-surface-only refactor.

## Acceptance Criteria
- `previewClearing` + `settle` live in a dedicated `BackofficeOfferingSettleService` owning the settle queue + bid repo.
- `BackofficeOfferingsService` no longer injects the settle queue or the bid repo (only what plan/approve use) and its docstring accurately describes its (reduced) responsibility.
- The controller injects both services; no route path or DTO changes; existing offering backoffice unit/integration/e2e suites stay green.

## Work Log
- 2026-08-20: created from PR #43 [architecture-strategist] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Extracted `previewClearing` + `settle` into a new `BackofficeOfferingSettleService`
(`backoffice-offering-settle.service.ts`), which owns the settle-only deps: `OFFERING_BID_REPOSITORY`, the
`OFFERING_SETTLE_QUEUE` producer, `offeringEscrowConfig`, idempotency, audit. `BackofficeOfferingsService`
now covers only planning (create) + approval (approve/list/getOne) and dropped its `bids` + `settleQueue`
injections and the settle-only imports. The controller injects both services (settle/preview routes →
`settleService`); routes/DTOs/behavior are unchanged. Module registers both providers. Updated the three unit
specs (offering-settle.service.spec constructs the new 6-dep service; the create/approval specs revert to the
8-dep BackofficeOfferingsService). Build green (TSC 0); 56/56 affected specs pass.
