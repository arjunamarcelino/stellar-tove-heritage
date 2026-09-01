---
status: complete
priority: p3
issue_id: 334
tags: [code-review, architecture, tov-160]
dependencies: []
---
# Settle-worker module polish: double boot-probe, shared reconcile toggle, worker-module naming asymmetry

## Problem Statement
Three minor, closely-related architecture observations around the new offering-settle worker module (TOV-160). None is a correctness bug — the DI wiring is sound and money-safety is preserved — but each is a small rough edge worth recording so the settle and deploy worker stacks stay legible as they grow.

## Findings
- **(1) DOUBLE BOOT-PROBE** — Both `src/modules/offerings/offering-settle-worker.module.ts` and `src/modules/offerings/deploy/offering-worker.module.ts` locally bind `{ provide: OFFERING_ESCROW_SERVICE, useClass: SorobanOfferingEscrowService }`. There is no DI conflict: each module scope gets its own instance, which is correct. But `SorobanOfferingEscrowService` implements `OnApplicationBootstrap` with a `probeOnBoot` RPC probe (admin assert + funding check). Because two scopes each instantiate it, on boot the probe now runs **twice** against the same admin account — redundant network I/O. Optional: gate the probe behind a one-shot latch (e.g. a shared module-static flag) so it runs once per process.
- **(2) SHARED RECONCILE TOGGLE** — `src/modules/offerings/offering-settle-reconcile.scheduler.ts` reuses `offeringEscrowConfig.reconcileEnabled` / `reconcileCron`. So `OFFERING_ESCROW_RECONCILE_ENABLED=false` silences **both** the deploy sweep **and** the money-settlement stale-`subscribed` re-drive — two different risk surfaces controlled by one flag. Optional: add a dedicated `OFFERING_SETTLE_RECONCILE_ENABLED` (and cron) so the settle re-drive can be toggled independently. Related: `settleGraceMs` lives under the `escrow` config namespace, which has become a catch-all.
- **(3) WORKER-MODULE NAMING ASYMMETRY** — The deploy worker is the generically-named `offering-worker.module.ts` / `OfferingWorkerModule`, while the new one is the specific `offering-settle-worker.module.ts` / `OfferingSettleWorkerModule`. Purely cosmetic — deploy simply claimed the generic name first. A future rename of the deploy module to `offering-deploy-worker.module.ts` would restore symmetry.

## Proposed Solutions
### Option A — Address all three as small follow-ups
- Description: Add a one-shot latch to `probeOnBoot`; introduce `OFFERING_SETTLE_RECONCILE_ENABLED` + cron and move `settleGraceMs` under a settle namespace; rename the deploy worker module for symmetry.
- Pros: Removes redundant boot I/O; decouples two independent risk surfaces; consistent naming.
- Cons: Config-surface churn (new env vars, Joi schema entries, docs); a module rename touches imports.
- Effort: Small-Medium
- Risk: Low

### Option B — Fix only the reconcile toggle split, defer the rest
- Description: Add `OFFERING_SETTLE_RECONCILE_ENABLED` (highest-value: it separates money-settlement from deploy-sweep control). Leave the double-probe and naming as documented accepted rough edges.
- Pros: Targets the one item with an operational risk surface; minimal churn.
- Cons: Leaves redundant boot probe and naming asymmetry.
- Effort: Small
- Risk: Low

### Option C — Document only
- Description: Record all three as accepted; no code change.
- Pros: Zero churn.
- Cons: Redundant boot I/O and coupled toggle persist.
- Effort: Tiny
- Risk: Low

## Recommended Action
Option B — split the reconcile toggle (`OFFERING_SETTLE_RECONCILE_ENABLED`) since it is the only item with a real operational risk surface (silencing the money re-drive as a side effect of disabling the deploy sweep). Add the one-shot probe latch opportunistically if `SorobanOfferingEscrowService` is touched for another reason. Defer the module rename to whenever the deploy module is next edited.

## Technical Details
- `probeOnBoot` runs admin `assert` + funding check via RPC; duplicating it doubles boot-time RPC calls but is otherwise harmless (idempotent reads).
- The reconcile scheduler and both worker modules all consume `offeringEscrowConfig`; a settle-specific config factory (or additional keys) would need registration in `app.module.ts` `ConfigModule.forRoot({ load: [...] })` and the Joi `validation-schema.ts`.

## Acceptance Criteria
- If implemented: the boot probe executes at most once per process regardless of how many scopes bind `SorobanOfferingEscrowService`.
- `OFFERING_SETTLE_RECONCILE_ENABLED` (if added) independently controls the settle re-drive without affecting the deploy sweep, validated by Joi and documented.
- Any decision to keep the current naming/coupling is recorded here as intentional.

## Work Log
- 2026-08-20: created from PR #43 review (architecture-strategist)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
(1) DOUBLE BOOT-PROBE: added a static one-shot `probed` latch to `SorobanOfferingEscrowService.onApplicationBootstrap`
so the admin-account funding probe runs ONCE even though both the deploy + settle worker modules bind the class
(each still gets its own instance — the latch only dedups the boot RPC). (2) SHARED RECONCILE TOGGLE: added an
independent `OFFERING_SETTLE_RECONCILE_ENABLED` config (`settleReconcileEnabled`, defaults to the deploy toggle
when unset) and switched the settle-reconcile scheduler to it, so money-settlement recovery can be toggled
separately from the deploy sweep. (3) NAMING ASYMMETRY (deploy = generic `OfferingWorkerModule`, settle =
specific `OfferingSettleWorkerModule`): left as-is by decision — renaming the shipped deploy module is churn/risk
for a cosmetic win; documented here. Also resolves #331's "keep the settle-reconcile separate" (kept separate,
now with its own toggle). Build green.
