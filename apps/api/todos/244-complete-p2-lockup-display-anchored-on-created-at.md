---
status: complete
priority: p2
issue_id: 244
tags: [code-review, correctness, data-integrity, TOV-237, PR-35]
dependencies: []
---

# Lockup display is anchored on `created_at`, not the on-chain deploy time

## Problem Statement
`lockedBalance` on `GET /v1/me/holdings` can unlock/lock at a visibly different instant than the FractionToken contract actually enforces, because the endpoint anchors the lockup window on the row-insert time rather than the deploy time.

## Findings
Flagged by data-integrity-guardian (P2) and kieran-typescript-reviewer (P2.4).
- `src/modules/fractionalization/me/me-holdings.service.ts:136-137`:
  `lockupEndMs = contract.createdAt.getTime() + artistLockupDays * MS_PER_DAY; if (now >= lockupEndMs) return 0n;`
- On-chain lockup is `computeLockupUntil(deployTsSeconds, days)` (`token-init.ts:34-35`) anchored on the **deploy/ledger** time. `created_at` is the fractionalize **request** time, which precedes deploy by the BullMQ queue + Soroban settlement window (minutes; longer on a stuck/reconciled row). So the displayed unlock instant drifts from the enforced one.
- Boundary semantics `now >= lockupEndMs → unlocked` (inclusive end) is fail-open, which is acceptable **only because this endpoint never authorizes a transfer** (the chain is the real gate). There is no test pinning `now === lockupEndMs` and no comment recording that this is display-only.
- Clock arithmetic itself is TZ-clean (`created_at` is `timestamptz` → `Date` UTC instant vs `Date.now()` UTC ms). No skew.

## Proposed Solutions
1. Anchor on a persisted deploy timestamp. `deploy_ledger` exists but is nullable/unrecoverable on the reconcile path; a dedicated `deployed_at` column (set in `casDeployed`) would be cleaner. Effort: Medium (migration + promote-path write). Risk: schema change.
2. Keep `created_at` for MVP but (a) add a comment pinning the "display-only; on-chain enforces the real gate; never use this to authorize a transfer" invariant, and (b) add a `now === lockupEndMs` boundary unit test. Effort: Small. Risk: none.
3. Derive lockup expiry from an on-chain read. Effort: Large; not worth it for a display card.

## Recommended Action
**RESOLVED — Solution 2 (user-confirmed, MVP).** Kept `created_at` as the anchor for now and made the semantics explicit: added a DISPLAY-ONLY invariant doc-block on `artistLockedAmount` (chain enforces the real gate; anchored on request-time so may drift; fail-open boundary; never reuse to gate a write path without a deploy-time anchor) + an inline comment on the `now >= lockupEndMs` branch. Added a boundary unit test pinning the inclusive-end semantics (locked 1s before end, unlocked 1ms past end). Switching to a `deployed_at` anchor is deferred (Solution 1) — recorded below as the follow-up if a write path ever consumes this value.

## Technical Details
- Files: `me-holdings.service.ts:129-140`; potential migration + `casDeployed` (`fraction-contract.repository.ts:50-65`); test `test/unit/modules/me-holdings/me-holdings.service.spec.ts`.

## Acceptance Criteria
- [x] Decision recorded: keep `created_at`, documented display-only (deploy-time anchor deferred).
- [x] Invariant comment added + inclusive-end boundary test.
- [ ] (Deferred follow-up) If a write path ever consumes locked/free: switch to a `deployed_at` anchor written on both promote paths.

## Work Log
- 2026-07-18: created from PR #35 review (data-integrity-guardian P2, kieran P2.4).
- 2026-07-18: RESOLVED — display-only invariant documented + boundary test added; build + 12 service tests green. Deploy-time anchor deferred per user.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
