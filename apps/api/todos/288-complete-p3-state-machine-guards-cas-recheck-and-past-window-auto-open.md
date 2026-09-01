---
status: complete
priority: p3
issue_id: 288
tags: [code-review, TOV-154, PR-39, correctness, state-machine]
dependencies: []
---

# State-machine hardening: CAS should re-check `status='planned'`, and a stale/past-window offering must not auto-open

## Problem Statement
Two related state-machine hardening items. Neither has a financial effect in THIS PR (subscription /
settlement are later FRs), but each is a gap introduced here that a future FR could turn into a real bug.

1. **`casEscrowDeployed` does not re-check `status`.** Its WHERE predicate is only
   `escrow_deploy_status='deploying'`, then it unconditionally SETs `status='approved'`. Safe *today*
   (the sole writer of `'deploying'` requires `status='planned'` and nothing else mutates `status` while
   a deploy is in flight), but a latent trap: a future cancel path that sets `status='canceled'` during
   an in-flight deploy would be silently resurrected to `'approved'`.

2. **Past `window_open_at` auto-opens on the next reconcile tick.** Planning intentionally allows
   `window_open_at` in the past (`open < close` only). The new reconcile
   `sweepWindowOpen → casOpened` (`status='approved' AND window_open_at<=now()`) means an offering
   planned with a past open time transitions `approved→opened` on the very next tick, skipping any
   intended pre-open wait — and can auto-open into an **already-closed** window.

## Findings
- **data-integrity-guardian (LOW/P3) — CAS status recheck:**
  `src/modules/offerings/repositories/offering.repository.ts:59-76` (`casEscrowDeployed`) matches only
  `escrow_deploy_status = 'deploying'` and unconditionally sets `status='approved'`. Adding
  `AND status='planned'` makes the state machine self-defend against any future writer of a different
  `status` during an in-flight deploy (e.g. cancel). Safe today only because `casEscrowDeploying`
  (`offering.repository.ts:45-57`) requires `status='planned'` and nothing else mutates `status`
  mid-deploy.
- **security-sentinel + performance (corroborating) — past-window auto-open:** planning allows a past
  `window_open_at` (`src/modules/backoffice/offerings/backoffice-offerings.service.ts:77-86`, only
  `open < close`). Reconcile `sweepWindowOpen` (`offering-reconcile.processor.ts:46-71`) →
  `findDueForOpen` (`offering.repository.ts:111-118`, `windowOpenAt <= now()`) →
  `casOpened` (`offering.repository.ts:88-96`, `status='approved' AND window_open_at<=now()`) promotes it
  on the next tick, with no guard that `window_close_at` is still in the future — so a stale offering can
  auto-open into an expired window.

## Proposed Solutions
### Option A (item 1) — Add `AND status='planned'` to `casEscrowDeployed`
- Tighten the WHERE so the deploy-latch only wins when the offering is still `planned`; a concurrent
  cancel (or any other `status` writer) then loses instead of being resurrected.
- **Pros:** one-line, self-defending state machine; no behavior change today. **Cons:** none material —
  a lost CAS must be handled the same as the existing lost-CAS path (it already returns `false`).
  **Effort:** Trivial. **Risk:** Very low.

### Option B (item 2) — Reject a past `window_open_at` at planning
- Add an `open > now()` (or `open >= now()`) check in `BackofficeOfferingsService` alongside
  `open < close`, so a stale offering can never exist.
- **Pros:** stops the problem at the source. **Cons:** contradicts the current deliberate "past window
  allowed at planning" decision (todo 265); may break intended back-dating use cases. **Effort:** Small.
  **Risk:** Medium (product-decision reversal).

### Option C (item 2) — Require `window_close_at > now()` at open time
- Keep planning permissive, but have `casOpened` / `findDueForOpen` additionally require
  `window_close_at > now()`, so a stale offering can't auto-open into an expired window; leave the M05
  open FR to treat a past-window offering as invalid before any money attaches.
- **Pros:** preserves the planning decision; closes the auto-open-into-expired gap where it matters.
  **Cons:** a stale offering then lingers in `approved` (never opens) until M05 handles it — acceptable,
  but needs a note. **Effort:** Small. **Risk:** Low.

## Recommended Action
Take **Option A** for item 1 (trivial, strictly safer). For item 2, prefer **Option C** (keep planning
permissive, gate the open on a still-open window) unless product wants to forbid back-dating outright
(Option B). At minimum, the M05 open FR must treat a past/expired-window offering as invalid before money
attaches.

## Technical Details
- `src/modules/offerings/repositories/offering.repository.ts`: `casEscrowDeployed` (~59-76),
  `casOpened` (~88-96), `findDueForOpen` (~111-118), `casEscrowDeploying` (~45-57, the sole `'deploying'`
  writer)
- `src/modules/offerings/deploy/offering-reconcile.processor.ts` (`sweepWindowOpen` ~46-71)
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts:77-86` (window validation)

## Acceptance Criteria
- [x] `casEscrowDeployed` re-checks `status='planned'` in its WHERE clause (does not blindly overwrite a
      concurrently-changed status).
- [x] A stale/expired-window `approved` offering is not auto-opened by reconcile (`casOpened`/`findDueForOpen`
      require `window_close_at > now()`).

## Resolution (2026-08-20 — "don't auto-open an expired window", per requester)
- **(a) CAS status recheck:** `casEscrowDeployed` WHERE now `id = :id AND escrow_deploy_status = 'deploying'
  AND status = 'planned'` — a concurrently-canceled in-flight deploy can no longer be resurrected to `approved`.
- **(b) Expired-window guard:** `casOpened` WHERE adds `AND window_close_at > now()`; `findDueForOpen` adds
  `windowCloseAt: MoreThan(now)`. An `approved` offering whose entire window has elapsed is left `approved`
  (an admin / later M05 FR handles it) instead of auto-opening into a dead window.
- Tests: integration +2 (I5c canceled-during-deploy not resurrected; I6b expired window not opened + excluded
  from findDueForOpen); existing I6 updated to an open-now window. e2e window-open (future close) still green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review. Item 1: data-integrity-guardian LOW/P3
- 2026-08-20 — Resolved. casEscrowDeployed status recheck + casOpened/findDueForOpen window_close_at guard; integration +2.
  (latent CAS trap). Item 2: security-sentinel + performance corroborate (past-window auto-open); no
  financial effect in this PR, but a state-machine gap introduced here.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
