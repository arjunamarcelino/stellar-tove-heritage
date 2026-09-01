---
status: complete
priority: p3
issue_id: 436
tags: [code-review, tov-33, pr-56, architecture, consistency, concurrency]
dependencies: []
---
# Rotation P3 architecture / consistency / concurrency nits (bundled)

## Resolution (2026-08-27)
**Applied:**
- **#1 cancel-vs-claim race (the real edge)** — fixed at the claim GATE rather than with a lock:
  `claimItemForSubmit` now filters `deleted_at IS NULL`, so a concurrently soft-canceled item can never be claimed
  and no money moves against a canceled rotation. Integration test added (softCancel → claim returns false). This
  is stronger than "softCancel under the source-wallet lock" (which wouldn't cover the un-locked claim path).
- **#3 imprecise `onApplicationBootstrap` comment** — reworded `wallet-rotation.module.ts`: the real benefit is
  dependency-surface minimization; `RelayerModule`/`KycAllowlistModule` run their own app-wide bootstrap
  singletons regardless, so the wiring doesn't "suppress a probe".
- **#7 "mirrors internal_audit_log" doc nit** — reworded `registry-event.entity.ts`: same append-only intent,
  newer `fn_/trg_` guard naming (not the older `*_immutable`).

**Consciously declined (documented-as-intended):**
- **#2 cross-feature table read (not a port)** — INTENTIONAL: a service-to-service seam between export and rotation
  would create a module cycle (both guard each other since todo 431). Table-level reads on both sides are the
  cycle-free design.
- **#4 side-effecting `GET /status`** — deliberate lazy-crash-recovery, faithfully mirroring the export precedent.
- **#5 read-error wrapping across 3 sites** — the three have DIFFERENT desired failure semantics: initiate
  fails-hard (503), the completion re-read fails-soft (don't complete), reconcile fails-soft (skip). Routing all
  through the throwing `readBalances` helper would be wrong; current explicit forms are clearer.
- **#6 per-item allowlist re-read** — required for mid-drain revocation; the throw path is now handled (todo 429).
- **#8 terse `wrt`/`wrti`/`re` initialisms / #9 item `varchar(40)` vs registry `numeric(39,0)`** — renaming/altering
  already-applied constraints is churn for zero behavior; item mirrors export's XDR-rebuild snapshot shape,
  registry mirrors the money-table norm. Left as a conscious call.

Build 0 issues; rotation integration 9/9.
## Problem Statement
Non-blocking structural + consistency items from the PR #56 review (architecture-strategist,
pattern-recognition-specialist, performance-oracle, data-integrity-guardian). None blocks merge; #1 (cancel lock)
is the most substantive.

## Findings
1. **`cancel`/`softCancel` take no source-wallet lock** (data-integrity P3). `finalizeIfAllConfirmed` serializes on
   a `pessimistic_write` lock of the source `Wallet` row, but `cancel` (`wallet-rotation.service.ts:410-436`) and
   `softCancel` (`wallet-rotation.repository.ts:160-167`) don't. In the narrow window between `submit` reading the
   rotation and `claimItemForSubmit` committing, a concurrent `cancel` can pass its "no submitted/confirmed items"
   check and soft-delete the parent+items; `claimItemForSubmit`'s raw `update` has no `deleted_at IS NULL` predicate
   → it claims a soft-deleted item and moves money → soft-deleted rotation with a confirmed money-moving item.
   Money-safe (balance drained, fresh rotation reads zero, registry still records it) but internally inconsistent.
   Route `softCancel` through the same source-wallet `pessimistic_write` lock.
2. **Cross-feature coupling to the `wallet_exports` table instead of a port** (architecture P3).
   `wallet-rotation.service.ts:116,133` reads the export domain's table directly for the conflict guard, duplicating
   knowledge of export's `status <> 'completed'` state machine. `WalletExportModule` already exports
   `WalletExportService` — a small `hasActiveExport(walletId)` seam would keep the boundary a service edge. (Note:
   this pairs with todo 431 — the guard should be bidirectional anyway.)
3. **Imprecise `onApplicationBootstrap`-avoidance comment** (architecture P3). `wallet-rotation.module.ts:29-33`
   justifies not importing `FractionalizationModule` to keep "an `onApplicationBootstrap` factory probe out of the
   wallet request graph", but `KycAllowlistModule`/`RelayerModule` (imported here) also implement
   `OnApplicationBootstrap`, and those probes are app-wide singletons that run regardless. The real benefit is
   dependency-surface minimization (not pulling `FRACTION_FACTORY_SERVICE`/`ARTWORK_REPOSITORY`). Re-word so a future
   reader doesn't treat "no probe in the request graph" as an invariant this wiring enforces.
4. **Side-effecting `GET` status route** (architecture P3). `GET :id/rotate-transfer/status`
   (`me-wallets.controller.ts:173` → `reconcileStuckItems` → confirm + registry insert + finalize) mutates state.
   Deliberate lazy-crash-recovery mirroring export, so consistent — but a REST-purity smell throttled as a read.
   Note only.
5. **Inconsistent read-error wrapping** (architecture P3). `initiate` funnels balance reads through the
   `readBalances` helper (maps `FractionReadUnavailableError → read_unavailable`), but the submit completion re-read
   (`:344`) and `reconcileStuckItems` (`:511`) call `balancesOf` directly with ad-hoc `catch`. Same dependency,
   three failure treatments (all fail-closed). Route all three through the helper.
6. **Per-item allowlist re-read = N sequential RPC** (performance P3). `:249` + `:285` issue up to N `is_allowed`
   simulate reads for the same frozen destination address. Deliberate (mid-drain revocation), but cacheable within
   the request if submit latency matters. (Pairs with todo 429 — the throw-after-claim wedge is the same call site.)
7. **Doc nit: "mirrors `internal_audit_log`" overstated** (patterns P3). `registry-event.entity.ts` + migration 054
   say the guard mirrors `internal_audit_log`'s trigger, but correctly use the newer `fn_/trg_registry_events_guard`
   naming (rfqs/quotes convention), not the older `internal_audit_log_immutable`. Behavior mirrors; naming doesn't.
8. **Terse constraint/index initialisms** (patterns P3). `wrt`/`wrti`/`re` (`FK_wrt_user`, `CHK_wrti_status`, …) are
   less legible than the word-mnemonic norm (`CHK_bid_status`, `FK_wallet_exports_wallet_id`). Readability nit only;
   internally consistent.
9. **Item `amount_scaled varchar(40)` vs registry `numeric(39,0)`** (patterns P3). Two schema conventions for a
   scaled-i128 string within one PR — item mirrors export's legacy shape, registry mirrors the money-table norm.
   Both defensible; a conscious call rather than inheritance-by-copy is worth making.

## Recommended Action
(blank — triage). #1 (cancel lock) is the only one with a real (narrow) correctness edge; the rest are
consistency/clarity.

## Resources
- PR #56; reviewers: architecture-strategist, data-integrity-guardian, performance-oracle, pattern-recognition-specialist.
