---
status: complete
priority: p2
issue_id: 231
tags: [code-review, performance, availability, config, TOV-235, PR-33]
dependencies: []
---

# BATCH_DEADLINE_MS is a between-items gate, not a true ceiling (+ hardcoded while cofactors are config) → gateway-timeout risk

## Problem Statement
`BATCH_DEADLINE_MS = 60_000` is meant to keep the synchronous request "under typical admin-gateway timeouts," but it is only checked *between* items — never plumbed into the in-flight `submitOne`/`pollToClosure`. The real wall-clock ceiling is `classify time + BATCH_DEADLINE_MS + one full item overrun` (~110s worst case), which can exceed a 60s proxy idle timeout. It is also a hardcoded constant while the values that determine the true duration (`submitTimeoutMs`, `maxBatch`) are runtime config, so the "stays under gateway timeout" guarantee silently weakens when those are tuned.

## Findings
- `src/modules/kyc-allowlist/kyc-allowlist.constants.ts:26` → `BATCH_DEADLINE_MS = 60_000` (hardcoded).
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts:112-121` checks `Date.now() > deadline` only at the top of each loop iteration; `submitOne` runs to its own `submitTimeoutMs` + RPC timeouts once entered.
- Deadline is computed AFTER `classify()` already consumed wall-clock (up to ~2 waves × ~10s at maxBatch 10 / RPC_CONCURRENCY 8).
- `submitTimeoutMs` default 15000 / max 30000, `maxBatch` default 5 / max 10 are config (`kyc-allowlist.config.ts`), but the deadline has no matching env knob → the three interacting bounds live in two layers and can drift.

## Proposed Solutions
### Option A (recommended): make the deadline a true ceiling + promote to config
- Compute one deadline at request entry (before `classify`), pass remaining budget into `submitOne` so `pollToClosure` caps at `min(submitTimeoutMs, remaining)`; stop + `deferred` when remaining < one item's realistic minimum. Promote `BATCH_DEADLINE_MS` to `kycAllowlistConfig` with a Joi default so all three bounds are validated together. Effort: Medium.

### Option B (simplify): drop the deadline, rely on maxBatch × submitTimeoutMs
- See todo 234 (simplicity) — with maxBatch ≤ 10 the `stopped`-on-pending latch + a tightened `maxBatch` ceiling may make the wall-clock deadline redundant. Effort: Small. (Choose A or B, not both.)

## Recommended Action
**RESOLVED (Option B — remove, per user).** Deleted `BATCH_DEADLINE_MS` and the between-items deadline branch. The serial loop now relies solely on the `pending` stop-latch (which defers the rest on an uncertain sequence); the small `maxBatch` cap (≤10) bounds total wall-clock. `deferred` stays meaningful (items after a pending). Removes the false "true ceiling" guarantee and one overlapping deferral mechanism.

## Technical Details
- Affected: `backoffice-kyc-allowlist.service.ts`, `soroban-kyc-allowlist.service.ts:pollToClosure`, `kyc-allowlist.constants.ts` / `kyc-allowlist.config.ts`.

## Acceptance Criteria
- [x] Deadline removed; design explicitly relies on the pending stop-latch + small maxBatch. Operators must set the gateway timeout above worst-case classify + maxBatch×submitTimeoutMs (documented in-code).
- [x] N/A — deadline removed; only submitTimeoutMs + maxBatch remain (both config).

## Work Log
- 2026-07-18: created from PR #33 review (performance-oracle P1-2 + architecture-strategist P2).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — removed BATCH_DEADLINE_MS; rely on pending stop-latch + maxBatch.
