---
status: complete
priority: p3
issue_id: 390
tags: [code-review, tov-177, pr-49, cleanup, observability, audit]
dependencies: [382]
---
# Dead code + quote-level audit-trail gap

## Problem Statement
A cluster of small dead-code / missing-audit items. None affect the happy path; together they reduce
future-maintainer confusion and close an audit gap on money-adjacent state changes.

## Findings
1. **Unused audit kinds → quote-level state changes have NO audit trail.** `QUOTE_ACCEPTED`,
   `QUOTE_SUPERSEDED`, `QUOTE_EXPIRED` were added to `AUDIT_KIND` (`wallets/audit/audit-log.types.ts:55-57`) but
   are never emitted — the settle worker's `casAccepted` / `supersedeOpenRivals` / `expireWithReason` run
   audit-less; only `TRADE_SETTLED` / `TRADE_FAILED` are recorded. These quote transitions are money-adjacent.
   → **Either emit them** (wire an audit row alongside each quote transition in `persist()`/`failTrade()`) **or
   drop the constants.** (Flagged by architecture + typescript.)
2. **Dead `AcceptContext.tokenAddress`.** `accept.service.ts:40,252` populates it but nothing in the accept flow
   reads it (the settler orchestrates the fraction leg; unlike `AuthContext.tokenAddress`, which `readBalance`
   uses). The `contract.tokenAddress` existence check at `:245` is still a useful gate — just stop threading the
   value into the returned context. (architecture + typescript + simplicity.)
3. **Dead reconcile scaffolding** — `findStalePending`, `IDX_secondary_trades_stale`, the reconcile config
   knobs. Tracked under [[382-pending-p1-settle-reconcile-backstop-missing]]; delete here only if 382 chooses
   Option B (don't build the worker).
4. **Duplicated per-request helpers across `accept.service.ts` and `authorize.service.ts`** — identical
   `key32()` (sha256(uuid)→Buffer), near-identical `resolveWallet`/`resolveSellerWallet` (same
   `EmbeddedWalletNotFoundError`→4xx mapping, differing only in error code), `mapRelayerError`, and a parallel
   `resolveContext`. A `settlement/accept/settlement-context.helpers.ts` could hold `key32`, the tuple builder
   (`{rfqId32,quoteId32,artworkId32,count,gross}`), and the wallet-resolution guard, parameterized by error
   code. The `sha256(uuid)→BytesN<32>` salt convention is a correctness-critical contract that should not be
   re-typed in three places (also in `soroban-marketplace-settler-read.service.ts:66` — that copy is a legit
   layer boundary). Judgment call at two callers, hence P3. (architecture + simplicity + performance M2.)

## Proposed Solutions
### Option A — Emit the audit kinds + remove the two dead fields (Recommended for 1 & 2)
- Wire `QUOTE_ACCEPTED`/`QUOTE_SUPERSEDED`/`QUOTE_EXPIRED` audit rows in the worker's quote transitions; drop
  `AcceptContext.tokenAddress`.
- Effort: Small · Risk: Low.
### Option B — Extract shared accept/authorize helpers (for 4)
- One `settlement-context.helpers.ts` shared by both services. Effort: Small · Risk: Low (net-neutral at two
  callers — do it if a third caller appears).

## Recommended Action
Option A now (audit trail is a real gap on a money surface; the dead field is free to remove). Defer Option B
unless touching these files anyway. Handle item 3 with 382.

## Technical Details
- Affected: `wallets/audit/audit-log.types.ts`, `settle/quote-settle.processor.ts` (emit audits),
  `accept.service.ts` (`tokenAddress`), optionally a new `settlement/accept/*.helpers.ts`.

## Acceptance Criteria
- [ ] Every quote state transition on the settle path either emits an audit row or its `AUDIT_KIND` constant is
      removed.
- [ ] `AcceptContext.tokenAddress` removed (existence gate at `:245` retained).

## Resolution (2026-08-22, complete)
1. **Audit kinds now emitted (Option A).** `SettlePersistenceService` writes, atomic with each transition:
   `QUOTE_ACCEPTED` (winning quote) + `QUOTE_SUPERSEDED` (when rivals were superseded, keyed on the winner with
   `supersededCount`) in `persistSettled`, and `QUOTE_EXPIRED` in `failTrade` on a seller-fault expiry. All three
   are gated on the CAS actually winning, so no spurious rows. The money-adjacent quote transitions now have a
   trail; no `AUDIT_KIND` constant is dead.
2. **Dead `AcceptContext.tokenAddress` removed** — the interface field + its population; the contract
   deployed+token-bound existence gate is retained (with a clarifying comment).
3. **Dead reconcile scaffolding** — resolved by [[382-complete-p1-settle-reconcile-backstop-missing]]
   (`findStalePending`, the stale index, and the reconcile config knobs are now consumed by the shipped
   reconcile worker). Nothing to remove.
4. **Duplicated accept/authorize helpers** — DEFERRED (Option B, judgment call at two callers). The most
   valuable dedup, `persist`/`failTrade`, was already extracted into `SettlePersistenceService` under #382; the
   remaining `key32`/`resolveWallet` twins are left as-is to keep this change focused (the read-service `key32`
   is a legit layer boundary regardless).

Verified: build 0, lint clean, accept e2e 4/4 (AC1 now asserts `quote.accepted` + `quote.superseded` audit rows
land), reconcile integration 3/3.

### Files changed
- `src/modules/marketplace/settlement/settle/settle-persistence.service.ts` (emit quote audits)
- `src/modules/marketplace/settlement/accept/accept.service.ts` (remove dead `tokenAddress`)
- `test/e2e/marketplace-accept.e2e-spec.ts` (audit-row assertions)

## Work Log
- 2026-08-22: Filed from PR #49 review (architecture + typescript + simplicity + performance).
- 2026-08-22: Emitted the quote audit kinds + removed dead field; helper-dedup deferred; complete.
