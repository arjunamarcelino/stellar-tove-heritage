---
status: complete
priority: p2
issue_id: 431
tags: [code-review, tov-33, pr-56, security, money-path, concurrency]
dependencies: []
---
# Rotation↔export mutual-exclusion is half-enforced; and the guard over-matches a terminal `failed` export

## Resolution (2026-08-27) — Solution 1+2 (bidirectional + active-only), user-confirmed to touch export
- **Rotation side** (`wallet-rotation.service.ts`): conflict query scoped to ACTIVE export states
  `In(['pending','submitting'])` (was `Not('completed')`) — a terminally-`failed` export no longer wedges rotation.
- **Export side** (`wallet-export.service.ts` `initiate` + `wallet-export.module.ts`): NEW reverse guard — refuses
  with `409 ROTATION_CONFLICT` if an active (`pending`/`submitting`) `wallet_rotation_transfers` row exists on the
  source. Done as a **table-level read** on both sides (each module `forFeature`-registers the other's entity), so
  the two features stay free of a module cycle (a service-to-service seam would cycle).
- **Tests**: rotation e2e — active export → 409, terminal `failed` export → 200; export e2e — active rotation → 409
  ROTATION_CONFLICT. Rotation e2e 8/8, export e2e 10/10 (unchanged), build 0.

## Problem Statement
Rotation documents a money-safety invariant — "an export and a rotation must not both drain the same source to
different destinations" — but only enforces one direction, and the direction it does enforce over-matches a
permanently-failed export (blocking rotation forever). Both are same-user + backstopped by on-chain
re-simulation (no double-spend), but a deliberate safety invariant is only half-real and a terminal export can
wedge rotation.

## Findings
- **One-directional guard.** `wallet-rotation.service.ts:131-136` refuses rotation if a non-completed `wallet_exports`
  row exists for the source. The reverse is missing: `WalletExportService.initiate` never checks for an active
  `wallet_rotation_transfers` row (`wallet-export.service.ts:78-120`). So with a rotation in flight, the user can
  still initiate an export that builds full-balance transfers to a different self-custody target → divergent
  provenance (a `custody_transfer` row + a competing export audit trail) and stuck partial states.
  (security-sentinel P2)
- **Over-match on terminal `failed`.** The guard uses `status: Not('completed')` (`:133-135`). Export statuses are
  `pending|submitting|completed|failed` — a permanently-`failed` export (no resumable items) still matches, so a
  user whose export failed terminally gets a spurious `409 ROTATION_CONFLICT` and can never rotate.
  (security-sentinel P3)

## Proposed Solutions
1. **Add the reverse guard in `WalletExportService.initiate`** (query `wallet_rotation_transfers` for a
   non-completed row on the source → refuse), OR **a shared per-`source_wallet_id` advisory lock** across both
   drains. Since WS-F (export refactor) was deliberately NOT done, a small reciprocal check is the pragmatic form.
   Effort: Small (reverse check) / Medium (shared lock).
2. **Scope both guards to genuinely-resumable states** (exclude terminal `failed`/`canceled`) so a dead export/rotation
   doesn't block the other. Effort: Small.
3. **Accept as documented** (money-safe via chain backstop) and note the limitation. Cons: leaves the invariant
   half-enforced and the terminal-failed wedge.

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] With an active rotation on a source, `POST …/export` on that source is refused (or serialized), and vice-versa.
- [ ] A terminally-`failed` export does not block a fresh rotation on the same source (and vice-versa).

## Resources
- PR #56; reviewer: security-sentinel. Overlaps the earlier plan-review SpecFlow M1 (cross-feature guard).
