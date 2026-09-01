---
status: complete
priority: p1
issue_id: 283
tags: [code-review, TOV-154, PR-39, reliability, concurrency]
dependencies: []
---

# Wedged 'deploying' offering has no reconcile/recovery path (non-atomic enqueue + expiry sweep can soft-delete a quorum-reached escrow)

## Problem Statement
The escrow-deploy enqueue is **non-atomic** with the DB latch, and no reconcile path recovers a stuck row.
In `backoffice-offerings.service.ts` `approve()`: the transaction commits `casEscrowDeploying`
(`escrow_deploy_status='deploying'`, `status` stays `'planned'`) at ~line 244, **then** `deployQueue.add(...)`
runs AFTER the commit (~line 246-260). If the process crashes or Redis is briefly unreachable so `.add`
throws:

1. **No job is ever enqueued** — the escrow deploy never happens.
2. **Nothing sweeps a stuck `'deploying'` row.** `offering-reconcile.processor.ts` only sweeps
   window-open + approval-expiry. The TOV-233 `findStaleDeploying` backstop was cut (Enhancement #7).
3. **Re-approve short-circuits with 409** `OFFERING_APPROVAL_IN_PROGRESS` (service ~line 213), and
   `casEscrowDeploying` only re-claims `NULL | failed` (`offering.repository.ts` ~line 52) — so a
   `'deploying'` row can never be re-claimed.
4. **Worse — the expiry sweep can destroy it.** Because `status` stays `'planned'`, after `ttlDays` the
   expiry sweep (`findExpiredOfferingIds` filters `status='planned'`) soft-deletes the approvals and emits
   `OFFERING_APPROVAL_EXPIRED` while the row is still wedged.

Result: a quorum-reached primary offering is permanently un-openable, requiring manual DB surgery, with no
alert.

**Second facet (idempotency).** When `deployQueue.add` throws post-commit, the catch calls
`idempotency.fail(key, token)`, clearing the key — so a same-key retry does **not** replay the original
`202`; it re-executes and hits `409 IN_PROGRESS`, violating the replay-idempotency contract the service
otherwise upholds.

Also note `OFFERING_ESCROW_UNAVAILABLE` (503) is declared (`error-code.enum.ts` ~line 103) but thrown
nowhere — likely the intended signal for this enqueue-failure path.

## Findings
- **architecture-strategist (P1):** the commit-then-enqueue ordering leaves a durable `'deploying'` latch
  with no owner if `.add` fails; the reconcile processor has no sweep for it, so recovery is manual.
  Evidence: `backoffice-offerings.service.ts` ~line 244 (commit of `casEscrowDeploying`) then ~line 246-260
  (`deployQueue.add`); `offering-reconcile.processor.ts` (only window-open + approval-expiry sweeps).
- **data-integrity-guardian (HIGH/P2):** the expiry sweep filters `status='planned'`, which a wedged
  `'deploying'` row still satisfies, so `findExpiredOfferingIds` soft-deletes the approvals and emits
  `OFFERING_APPROVAL_EXPIRED` on a quorum-reached row. Evidence: `findExpiredOfferingIds` (status='planned'
  filter); `casEscrowDeploying` re-claims only `NULL | failed` (`offering.repository.ts` ~line 52);
  re-approve 409 (`backoffice-offerings.service.ts` ~line 213).
- **performance-oracle / security-sentinel (corroborate):** no observability on deploying-age; the
  declared `OFFERING_ESCROW_UNAVAILABLE` (503) at `error-code.enum.ts` ~line 103 is unused and is the
  natural signal for the enqueue-failure path; idempotency `fail()` after a committed side effect breaks
  replay.

## Proposed Solutions
### Option A — Reconcile sweep for stale 'deploying' rows (restore TOV-233 parity) [recommended]
Add a bounded `findStaleDeploying(graceMs, batch)` sweep to the reconcile processor that re-drives
`'deploying'` rows older than a grace window through the self-healing `deployEscrow` (which already adopts
an existing on-chain instance if one was created). ALSO exclude `'deploying'` from the expiry sweep and add
observability on deploying-age. Complete the idempotency record (don't `fail()` the key after a committed
side effect) and let the reconcile own delivery.
- **Pros:** recovers crashes automatically; restores the TOV-233 backstop; closes the expiry-destroys-escrow
  hole; preserves replay-idempotency. **Cons:** more reconcile surface + a grace-window tuning knob.
  **Effort:** Medium. **Risk:** Low-Medium (re-drive must stay idempotent, which `deployEscrow` already is).

### Option B — Transactional outbox
Write the enqueue intent as a row in the same transaction as `casEscrowDeploying`; a dispatcher delivers to
BullMQ and marks it sent.
- **Pros:** truly atomic latch+enqueue; general-purpose. **Cons:** new outbox table + dispatcher; heavier
  than the problem. **Effort:** Large. **Risk:** Medium.

### Option C — Minimum viable hardening
Exclude `'deploying'` from the expiry sweep; add a metric/alert on deploying-age; wire
`OFFERING_ESCROW_UNAVAILABLE` (503) on the enqueue-failure path; complete (not `fail()`) the idempotency
record after commit.
- **Pros:** stops the destructive expiry + surfaces the stuck state; small. **Cons:** still needs an
  operator to re-drive (no auto-recovery). **Effort:** Small. **Risk:** Low.

## Recommended Action
Do **Option A**. It restores the TOV-233 `findStaleDeploying` parity that was cut, auto-recovers the
crash-between-commit-and-enqueue window, and fixes the expiry-destroys-escrow and idempotency facets in one
pass. Fold in Option C's expiry-exclusion + `OFFERING_ESCROW_UNAVAILABLE` wiring as part of it.

## Technical Details
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` (~line 213, 244, 246-260)
- `src/modules/offerings/offering-reconcile.processor.ts`
- `src/modules/offerings/offering.repository.ts` (~line 52 `casEscrowDeploying`; `findExpiredOfferingIds`)
- `src/common/enums/error-code.enum.ts` (~line 103 `OFFERING_ESCROW_UNAVAILABLE`)

## Acceptance Criteria
- [x] A crash between the `casEscrowDeploying` commit and `deployQueue.add` is recoverable without manual
      DB edits.
- [x] The expiry sweep never fires on a `'deploying'` row (no soft-delete / `OFFERING_APPROVAL_EXPIRED` on
      a quorum-reached escrow).
- [x] Deploying-age is observable (metric/log/alert). — the stale-deploy sweep `logger.warn`s each re-drive.
- [x] Re-approve after a lost enqueue eventually results in a deployed escrow.
- [x] A same-key retry after a post-commit enqueue failure replays the original `202` (idempotency record
      completed, not failed).

## Resolution (2026-08-20 — Option A)
Implemented the TOV-233-parity stale-deploying backstop + made the enqueue best-effort + de-fanged expiry.

**Code:**
- `offering.repository.ts` — added `findStaleDeploying(graceMs, batch)` (rows in `escrow_deploy_status='deploying'`
  with `updated_at < now()-grace`; `updated_at` is when the row entered `deploying`).
- `offering-approval.repository.ts` — `findExpiredOfferingIds` now excludes offerings with a non-NULL
  `escrow_deploy_status` (`AND o.escrow_deploy_status IS NULL`), so a wedged `deploying` row (still
  `status='planned'`) can't have its approvals wiped.
- `offering-reconcile.processor.ts` — new **sweep 0** `sweepStaleDeploying`: re-enqueues each stale row with a
  fresh per-attempt `jobId` (deploy processor no-ops unless still `deploying`, so a duplicate is harmless);
  injects `@InjectQueue(OFFERING_ESCROW_DEPLOY_QUEUE)` + `cfg.deployGraceMs`; per-item try/catch + `logger.warn`.
- `backoffice-offerings.service.ts approve()` — restructured: only the DB txn is guarded by `idempotency.fail()`;
  after commit we `idempotency.complete()` **before** the enqueue, and the enqueue is now **best-effort**
  (try/catch → `logger.warn`, never `fail()` after a committed side effect). So a post-commit enqueue failure
  no longer breaks replay-idempotency, and the reconcile sweep re-drives the deploy.
- New config `OFFERING_ESCROW_DEPLOY_GRACE_MS` (default 120000, Joi `min(90000)` > processor lockDuration 90s);
  added to `.env`/`.env.example`.
- **`OFFERING_ESCROW_UNAVAILABLE` NOT wired** — the chosen best-effort-enqueue design means `/approve` always
  returns 202 (no synchronous escrow-unavailable surface), so the 503 code is genuinely unused → dropped in
  todo 291 (which depends on this decision).

**Tests:** reconcile unit +3 (stale re-enqueue / per-item isolation / no-op); integration +2 (`findStaleDeploying`
grace filter; expiry excludes mid-deploy); e2e +1 (wedged `deploying` → reconcile → `approved`). All green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review.
- 2026-08-20 — Resolved (Option A). Stale-deploying reconcile sweep + best-effort enqueue + expiry exclusion; unit/integration/e2e added; build+lint green.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
