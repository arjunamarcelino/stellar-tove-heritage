---
status: complete
priority: p3
issue_id: 292
tags: [code-review, robustness, pattern, TOV-154, PR-39]
dependencies: []
---

# Robustness/consistency: WASM-hash case normalization, soft-delete updated_at, migration VALIDATE precondition

## Problem Statement
Three small robustness/consistency items on the escrow deploy + persistence path. Each is correct for the
data reality today but leaves a latent footgun for a plausible near-future input.

## Findings
- **pattern-recognition-specialist + data-integrity-guardian (P3):** three items.

(a) **WASM-hash compare is case-sensitive against a case-insensitive input (operational footgun).**
`src/modules/offerings/escrow/soroban-offering-escrow.service.ts` (~110-114) compares `onChainWasm`
(lowercase, from `Buffer.toString('hex')`) to `cfg.wasmHash` **verbatim**. But
`OFFERING_ESCROW_WASM_HASH` is validated only by `Joi.string().hex().length(64)`, and Joi `.hex()`
**accepts uppercase**. An operator supplying a mixed/upper-case hash deploys fine (`Buffer.from(hash,
'hex')` is case-insensitive) but then hits a **false** `OfferingEscrowWasmMismatchError` on every
self-heal / BullMQ retry. The DB convention elsewhere pins hex hashes lowercase (`CHK_fc_wasm_hash` ~
`'^[0-9a-f]{64}$'`).

(b) **Soft-delete does not bump `updated_at` (consistency).** `softDeleteAllForOffering`
(`src/modules/offerings/repositories/offering-approval.repository.ts` ~64-71) sets only `deletedAt`.
Every escrow CAS in `offering.repository.ts` explicitly sets `updatedAt: () => 'now()'` because a raw
`QueryBuilder` update does **not** auto-touch `@UpdateDateColumn`. So a soft-deleted approval keeps its
original `updated_at`, diverging from the house pattern. One-line fix. (data-integrity-guardian P3)

(c) **Immediately-validated CHECK constraint is vacuously safe but undefended.** Migration
`1716000000034` adds `CHK_off_approved_has_escrow` as an **immediately validated** constraint. It passes
today only because TOV-152 has so far written exclusively `'planned'` rows; if any offering already
existed in `approved|opened|subscribed|settled` with a NULL `escrow_contract_address`, the `ALTER` would
hard-fail. Correct for current data reality, but nothing guards the assumption. (data-integrity-guardian
P3)

## Proposed Solutions
### Option A — Do all three
- (a) Normalize the config value to lowercase at load (or `.toLowerCase()` both sides of the compare).
- (b) Add `updatedAt: () => 'now()'` to `softDeleteAllForOffering` to match the CAS pattern.
- (c) Either document a pre-migration guard query (a precondition check that no non-`planned` row has NULL
  `escrow_contract_address`) or rewrite as `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE
  CONSTRAINT`, making the migration robust to pre-existing data.
- **Pros:** removes the operational footgun and two latent inconsistencies. **Cons:** touches a migration.
  **Effort:** Small. **Risk:** Low.

### Option B — Fix the footgun now, defer the rest
- Do (a) immediately (it silently breaks retries on a legitimate operator input); defer (b) cosmetic and
  (c) currently-vacuous.
- **Pros:** closes the one item with real operational impact. **Cons:** leaves the migration undefended if
  data reality changes before it runs. **Effort:** Trivial. **Risk:** Low.

## Recommended Action
Prefer **Option A**. At minimum take **Option B** — (a) is the only one that can bite an operator today,
via a false `OfferingEscrowWasmMismatchError` on every self-heal/retry.

## Technical Details
- `src/modules/offerings/escrow/soroban-offering-escrow.service.ts` (~110-114) — WASM-hash compare
- `src/config/offering-escrow.config.ts` — `OFFERING_ESCROW_WASM_HASH` Joi `.hex().length(64)`
- `src/modules/offerings/repositories/offering-approval.repository.ts` (~64-71) — `softDeleteAllForOffering`
- `src/modules/offerings/repositories/offering.repository.ts` — CAS `updatedAt: () => 'now()'` precedent
- `src/database/migrations/1716000000034*.ts` — `CHK_off_approved_has_escrow`

## Acceptance Criteria
- [x] WASM-hash compare is case-normalized (config `wasmHash` lowercased at load).
- [x] `softDeleteAllForOffering` bumps `updated_at` to match the raw-update house pattern.
- [x] The `CHK_off_approved_has_escrow` validate strategy is documented as a deployment precondition.

## Resolution (2026-08-20 — all three)
- **(a)** `offering-escrow.config.ts` lowercases `OFFERING_ESCROW_WASM_HASH` at load
  (`.toLowerCase()`). The on-chain hash is `Buffer.toString('hex')` (always lowercase), so an
  uppercase-but-Joi-valid env value can no longer produce a false `OfferingEscrowWasmMismatchError` on the
  self-heal/retry path.
- **(b)** `offering-approval.repository.ts softDeleteAllForOffering` now `.set({ deletedAt, updatedAt })`
  (the append-only trigger permits `updated_at` on the NULL→ts soft-delete). Matches every escrow CAS.
- **(c)** Documented the `CHK_off_approved_has_escrow` immediate-validate precondition in migration 034's
  header (safe because all existing rows are `planned`; use `NOT VALID` + `VALIDATE CONSTRAINT` if a prod
  dataset ever holds a post-approval row with a NULL escrow address). Comment-only — the applied schema is
  unchanged and correct for current data.
- Build + lint + offerings integration (17) green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review (pattern-recognition-specialist +
  data-integrity-guardian, P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
