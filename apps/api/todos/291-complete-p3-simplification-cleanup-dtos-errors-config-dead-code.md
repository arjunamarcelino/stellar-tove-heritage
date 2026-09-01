---
status: complete
priority: p3
issue_id: 291
tags: [code-review, simplicity, cleanup, TOV-154, PR-39]
dependencies: [283]
---

# Simplification cleanup: merge escrow DTOs, collapse error hierarchy, drop dead code + unused config knob

## Problem Statement
A cluster of YAGNI/simplification cleanups on the offering-escrow path. Individually minor; together they
remove roughly 120-160 LOC of speculative surface (an unthrown error code, duplicated DTOs, an
undifferentiated error hierarchy, a doubled guard, and a single-use config knob) without changing
behavior.

## Findings
- **code-simplicity-reviewer (P3):** five simplifications + one minor, net ~120-160 LOC reduction.

1. **Dead error code (CONTINGENT on todo 283).** `OFFERING_ESCROW_UNAVAILABLE`
   (`src/common/enums/error-code.enum.ts` ~line 103) is declared but thrown nowhere in `src/` or `test/`.
   **However** it may instead be *intended* as the 503 for the enqueue-failure path being wired in todo
   283. This item is therefore contingent: if 283 wires it, **keep**; if 283 lands without using it,
   **drop** it. (Hence `dependencies: [283]`.)

2. **Two DTOs for one projection.** `src/modules/backoffice/offerings/dto/offering-list-item.dto.ts` and
   `offering-detail.dto.ts` are the same shape — list-item is detail minus `signers`, and `signers` is
   already `@ApiPropertyOptional` on the shared `ApprovalSummaryDto`. So there are two DTOs plus two
   near-identical `build()` methods for one shape. Merge into one view DTO; the list path simply omits
   `signers`.

3. **Error hierarchy no consumer discriminates.** `src/modules/offerings/escrow/offering-escrow.errors.ts`
   (~18-48) declares four subclasses (`Throttled` / `Sequence` / `ParamDrift` / `WasmMismatch`) over a
   `retryable`-flag base, but no consumer branches on subclass — the only discrimination anywhere is
   `err instanceof OfferingEscrowError && err.retryable`. Reduce toward the base
   `OfferingEscrowError(msg, retryable)`; at most keep subclasses thrown from *outside* the adapter (e.g.
   `EscrowParamDriftError`, thrown in the mapper) for readability.

4. **Doubled null-retention guard.** `mapConstructorArgs` and `assertPublicFloatMatches`
   (`src/modules/offerings/deploy/offering-escrow-args.mapper.ts` ~26 and ~52) each independently run the
   same null-retention → `EscrowParamDriftError` check, and the processor calls them back-to-back — so the
   identical check runs twice per deploy. Consolidate to one guard.

5. **Single-use config knob.** `OFFERING_ESCROW_DEPLOY_TIMEOUT_MS`
   (`src/config/offering-escrow.config.ts` ~line 59) is used *only* to pad `lockTtl`; it never bounds an
   operation (RPCs use a hardcoded `RPC_TIMEOUT_MS`). Sibling configs use a single `deployTimeoutMs` as
   the poll deadline; here the poll deadline is a separate `pollTimeoutMs`. Fold the lock-pad derivation
   onto `pollTimeoutMs + buffer` and drop the knob plus its Joi line. (Cross-ref todo 285, which also
   touches lock-TTL sizing.)

6. **Minor: test-only wrapper exported from production adapter.** `deriveOfferingEscrowAddressFor`
   (`src/modules/offerings/escrow/soroban-offering-escrow.service.ts` ~line 236) is a convenience wrapper
   whose only caller is the golden-vector spec, which could call
   `deriveOfferingEscrowAddress(pub, escrowSalt(id), net)` directly.

## Proposed Solutions
### Option A — One cleanup pass across the cluster
- Resolve 283 first (or in tandem) to decide item 1; then merge DTOs, minimize the error hierarchy,
  consolidate the guard, fold the config knob, and inline the test-only wrapper.
- **Pros:** ~120-160 LOC gone; one DTO/one guard/one timeout knob to reason about. **Cons:** broad diff;
  needs 283 resolved for item 1. **Effort:** Small-Medium. **Risk:** Low (no behavior change).

### Option B — Cherry-pick the safest two
- Do only the dead-code drop (item 1, once 283 is settled) and the DTO merge (item 2); defer the error
  hierarchy, guard, config, and wrapper items.
- **Pros:** smallest safe win. **Cons:** leaves most duplication in place. **Effort:** Trivial.
  **Risk:** Very Low.

## Recommended Action
Prefer **Option A** once todo 283 is resolved (it decides item 1). If 283 is still open, take **Option B**
now and revisit the remainder with 283.

## Technical Details
- `src/common/enums/error-code.enum.ts` (~line 103) — `OFFERING_ESCROW_UNAVAILABLE`
- `src/modules/backoffice/offerings/dto/offering-list-item.dto.ts`, `dto/offering-detail.dto.ts`,
  `dto/approval-summary.dto.ts` (`signers` optional)
- `src/modules/offerings/escrow/offering-escrow.errors.ts` (~18-48)
- `src/modules/offerings/deploy/offering-escrow-args.mapper.ts` (~26, ~52)
- `src/config/offering-escrow.config.ts` (~line 59) + its Joi validation line
- `src/modules/offerings/escrow/soroban-offering-escrow.service.ts` (~line 236)

## Acceptance Criteria
- [x] No dead `OFFERING_ESCROW_UNAVAILABLE` — removed (283 chose best-effort enqueue → no synchronous 503 surface).
- [x] One view DTO serves both the list and detail paths; the list path omits `signers`.
- [x] The null-retention guard runs once per deploy, not twice.
- [x] One deploy-timeout knob; `OFFERING_ESCROW_DEPLOY_TIMEOUT_MS` and its Joi line removed (done in 285).
- [~] Escrow error hierarchy — KEPT (documented rationale below).

## Resolution (2026-08-20)
- **Dead 503 removed:** `OFFERING_ESCROW_UNAVAILABLE` deleted from `error-code.enum.ts`. Todo 283's
  best-effort-enqueue design means `/approve` never surfaces a synchronous escrow-unavailable error, so the
  code had no thrower.
- **DTO merge:** deleted `offering-list-item.dto.ts`; `list()` now builds `OfferingDetailDto` (omitting
  `signers`, which is already `@ApiPropertyOptional` on the shared `ApprovalSummaryDto`). One view DTO for
  list + detail; controller `@ApiPaginatedResponse(OfferingDetailDto)`.
- **Guard de-dup:** extracted `requireRetentions(off, fc)` in `offering-escrow-args.mapper.ts`; both
  `mapConstructorArgs` and `assertPublicFloatMatches` call it (was two identical null-retention checks
  running back-to-back per deploy).
- **Config knob:** `OFFERING_ESCROW_DEPLOY_TIMEOUT_MS` already removed in todo 285.
- **Error hierarchy — KEPT (won't-change, rationale):** the 4 subclasses are referenced BY NAME across the
  adapter, mapper, fake, and 3 test files, and `EscrowParamDriftError` is thrown from outside the adapter
  (mapper). Collapsing them to `new OfferingEscrowError(msg, retryable)` is a 7-file churn (including test
  rewrites) for a marginal readability gain — net churn, not simplification. The `retryable` flag already
  gives the one behavioral branch the processor needs. `deriveOfferingEscrowAddressFor` (test-only wrapper)
  likewise kept — trivial, and moving it would only relocate the golden-vector's import.
- Build + lint + offerings unit (113) + e2e (9) green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review (code-simplicity-reviewer, P3). Item 1 made contingent
  on todo 283 (`dependencies: [283]`).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
