---
status: complete
priority: p3
issue_id: 434
tags: [code-review, tov-33, pr-56, simplicity, yagni]
dependencies: []
---
# Rotation P3 simplicity / dead-surface nits (bundled)

## Resolution (2026-08-27)
**Applied:**
- **#1 Dropped the two unused `@ManyToOne` relations** (`sourceWallet`/`destinationWallet`) on
  `wallet-rotation-transfer.entity.ts` — kept the scalar `*_wallet_id` columns + the `items` `@OneToMany`.
- **#5 Hoisted `ledgerNumberTransformer`** to a single shared `src/modules/wallets/ledger-number.transformer.ts`;
  the rotation item, registry-event, AND export item entities now import it (removed export's inlined copy and
  the rotation-local file). One definition.

**Consciously declined (documented-as-intended, no code change):**
- **#2 Parent `'failed'` state** — kept for parent/item + export/rotation vocabulary symmetry. The parent CHECK is
  a harmless permissive superset; narrowing it would require a migration ALTER on an already-applied table for a
  dead-but-inert value. Left as-is.
- **#3 Reader-less `registry_events` secondary indexes** — kept (cheap, forward-looking for the future provenance
  read; dropping applied indexes is churn for zero behavior). `UQ_registry_events_source_ref` stays load-bearing.
- **#4 Single-value `RegistryEvent` discriminator** — deliberate immutable-ledger framing; keep.
- **#6 `findAllDeployed()` over-fetch / #7 duplicate `SorobanFractionReadService` instances** — negligible /
  architectural; deferred (premature to optimize while the catalog is small; consolidation is a cross-cutting
  follow-up if the read port proliferates).

Full unit + rotation integration + export/rotation e2e green; build 0 issues.
## Problem Statement
Non-blocking YAGNI / dead-surface items from the PR #56 review (code-simplicity-reviewer, plus overlap from
performance/architecture). The money-safety spine is warranted and untouched; these are removable surface only.
None blocks merge.

## Findings
1. **Two unused `@ManyToOne` relations on the rotation parent entity.**
   `entities/wallet-rotation-transfer.entity.ts:25-34` — `sourceWallet`/`destinationWallet` are never loaded
   (every query uses `relations: { items: true }`) and never read. Keep the scalar `*_wallet_id` columns + the
   `items` `@OneToMany`; drop the two `@ManyToOne`/`@JoinColumn` pairs. (The item's inverse `rotation` `@ManyToOne`
   must stay — required by the `OneToMany(..., i => i.rotation)` mapping.)
2. **Parent `'failed'` state is unreachable** (dead across 5 sites). The parent status is only ever `pending`,
   `submitting`, or `completed` — a fully-failed rotation rests at `submitting` (resumable). `'failed'` is
   vestigial from the export copy in: `rotation-status.types.ts:10`, `mapRotationStateForRead` case
   (`wallet-rotation.service.ts:82-83`, unhittable), `RotationReadState`/Swagger enum
   (`dto/rotate-transfer-status-response.dto.ts:5,17`), and the `CHK_wrt_status` list (migration 053). Dropping it
   from the PARENT vocabulary lets `assertNever` compile-enforce the narrowed union. (Keep it in the ITEM vocabulary
   — items genuinely go `failed`.) Defensible to keep only for export/rotation symmetry.
3. **`registry_events` secondary indexes have no reader.** `IDX_registry_events_user` and the BRIN
   `IDX_registry_events_created_brin` (migration 054) serve zero queries — the table is write-only until a
   provenance-read ships. Consider deferring both to that ticket. Keep `UQ_registry_events_source_ref`
   (load-bearing for `ON CONFLICT`).
4. **`RegistryEvent` is a single-value discriminator.** `event_type` / `RegistryEventType` / `CHK_re_event_type`
   all carry exactly one literal (`custody_transfer`). Deliberately-generic immutable-ledger framing is sound —
   flagged for awareness, not removal.
5. **`ledgerNumberTransformer` duplicated** across `rotation/ledger-number.transformer.ts:6-9` and the private
   inline copy in `export/entities/wallet-export-item.entity.ts:11`. Rotation's extracted form is the better
   factoring; hoisting one shared copy (and having export import it) removes the dup. Touches export — mild scope.
6. **`findAllDeployed()` over-fetches full `FractionContract` rows** (`wallet-rotation.service.ts:141`) when only
   `tokenAddress`/`artistAddress`/`artistLockupUntil`/`artistRetentionAmount` are used. Negligible while the table
   is small; only relevant once the contract count grows (see the enumerate ceiling note).
7. **N independent `SorobanFractionReadService` instances** (each holds its own `rpc.Server`): now bound in
   `FractionalizationModule`, `MeHoldingsModule`, and `WalletRotationModule`. Correctness-neutral; if the port
   proliferates, a shared exported read module is the cleaner consolidation. (architecture)

## Recommended Action
(blank — triage). Cleanest fully-in-scope wins: (1) and (2). (3)/(5) fast-follows. (4)/(6)/(7) judgment calls.

## Resources
- PR #56; reviewers: code-simplicity-reviewer, performance-oracle, architecture-strategist.
