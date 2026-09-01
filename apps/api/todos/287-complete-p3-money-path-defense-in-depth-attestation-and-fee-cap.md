---
status: complete
priority: p3
issue_id: 287
tags: [code-review, TOV-154, PR-39, security, soroban]
dependencies: []
---

# Money-path defense-in-depth: attest constructor supply/retentions individually + cap the deploy tx fee

## Problem Statement
Two related defense-in-depth gaps on the OfferingEscrow deploy money path. Both are currently
**theoretical** (no live exploit under the present state machine), but each removes a latent way for the
on-chain escrow to be deployed with parameters the approvers never reviewed, or for the shared funded
admin account to be drained.

1. **Individual constructor-param attestation.** Approval freezes only `snapshot_artist_address` and —
   via the `public_float` identity — the *difference* `total_supply − artist_retention −
   treasury_retention`. But `mapConstructorArgs` bakes `total_supply`, `artist_retention`, and
   `treasury_retention` **individually** from the live `fraction_contracts` row. Two different
   `(supply, artistRet, treasuryRet)` triples can share the same `public_float`
   (e.g. `1000/100/100` vs `2000/600/600` → both `800`), so `assertPublicFloatMatches` passes while the
   escrow is deployed with a different supply/allocation than approvers reviewed.

2. **Deploy tx fee ceiling.** The escrow deploy builds with `fee: BASE_FEE`, then
   `rpc.assembleTransaction(tx, sim)` sets the final fee from simulation with **no cap**, and the admin
   signs whatever comes back. The sibling relayer money path caps fees; this path has no equivalent.

## Findings
- **security-sentinel (LOW/P3) — individual param attestation:** approval only freezes
  `snapshot_artist_address` + the `public_float` *difference*, but
  `src/modules/offerings/deploy/offering-escrow-args.mapper.ts:33,35,37` bakes `totalSupply`,
  `artistRetention`, and `treasuryRetention` individually from the live `fraction_contracts` row.
  `assertPublicFloatMatches` (`offering-escrow-args.mapper.ts:50-64`) only checks the difference, so a
  supply/allocation swap that preserves `public_float` deploys undetected.
  *Currently theoretical:* `fraction_contracts` is immutable after the deploy CAS, and an offering can
  only be approved once its contract is `deployed`, so there is no live mutation window today.
- **security-sentinel (LOW/P3) — fee ceiling:**
  `src/modules/offerings/escrow/soroban-offering-escrow.service.ts:129-135,144` builds with
  `fee: BASE_FEE`, then `rpc.assembleTransaction(tx, sim).build()` reprices from simulation with no
  bound, and `prepared.sign(this.admin)` signs it. The relayer path enforces a cap
  (`src/modules/relayer/soroban-relayer.service.ts:387-388`, `RELAYER_MAX_TX_FEE`, Joi
  `.max(100000000)` in `src/config/validation-schema.ts:66`); the escrow path has none.
  *Exposure:* a compromised/misbehaving RPC returning an inflated resource fee could drain the shared
  funded admin account across BullMQ retries.

## Proposed Solutions
### Option A — Do both (attest individually + cap the fee)
- **(a)** At first approval, snapshot `total_supply`, `artist_retention_amount`,
  `treasury_retention_amount` onto the offering (alongside the existing `snapshot_artist_address`), and
  in the deploy processor assert each equals the live `fraction_contracts` value before build (terminal
  `EscrowParamDriftError` on any mismatch, mirroring the existing null/drift guard).
- **(b)** Add an `OFFERING_ESCROW_MAX_TX_FEE` config (Joi-validated, mirror the relayer bound) and assert
  `prepared.fee <= max` before `prepared.sign(this.admin)`; throw a terminal error otherwise (mirror the
  relayer transfer fee-cap at `soroban-relayer.service.ts:387`).
- **Pros:** closes both latent money-path gaps; brings the escrow path to relayer-path parity; cheap
  new columns + one config key. **Cons:** a migration for the snapshot columns + touchpoints in
  approve/deploy. **Effort:** Small–Medium. **Risk:** Low (additive asserts, no behavior change on the
  happy path).

### Option B — Defer with a documented risk-acceptance
- Record that both are theoretical under the current immutable-`fraction_contracts` + approve-only-when-
  `deployed` invariant, and gate the work on the invariant ever weakening (e.g. a redeploy/mutation path).
- **Pros:** no code churn now. **Cons:** the protections are absent exactly when a future change quietly
  breaks the invariant; a bad RPC fee remains uncapped in the meantime. **Effort:** Trivial.
  **Risk:** Low now, higher if the invariant changes without anyone re-checking this todo.

## Recommended Action
Prefer **Option A** (do both) since each is a small, additive belt on a money path and the fee cap has a
proven sibling to copy. If deferred, take **Option B** and explicitly link the risk-acceptance to the
`fraction_contracts`-immutability invariant so it re-surfaces if that invariant is ever relaxed.

## Technical Details
- `src/modules/offerings/deploy/offering-escrow-args.mapper.ts` (`mapConstructorArgs` ~33/35/37;
  `assertPublicFloatMatches` ~50-64)
- `src/modules/offerings/escrow/soroban-offering-escrow.service.ts` (~129-135 build, ~144 assemble+sign)
- `src/modules/offerings/entities/offering.entity.ts` (`snapshot_artist_address` at ~74; add
  `snapshot_total_supply` / `snapshot_artist_retention_amount` / `snapshot_treasury_retention_amount`)
- `src/config/offering-escrow.config.ts` + `src/config/validation-schema.ts` (add
  `OFFERING_ESCROW_MAX_TX_FEE`)
- Reference: `src/modules/relayer/soroban-relayer.service.ts:387-388`, `src/config/relayer.config.ts:31`

## Acceptance Criteria
- [~] Individual `total_supply`/retention attestation — **DEFERRED** (documented, see Resolution). Not
      exploitable while `fraction_contracts` is immutable post-deploy.
- [x] The deploy transaction fee is capped by config (assert `prepared.fee <= max` before signing; a
      value above the cap fails terminally, not silently signed).

## Resolution (2026-08-20 — "fee-cap only, document the rest", per requester)
- **287(b) fee cap — DONE.** New config `OFFERING_ESCROW_MAX_TX_FEE` (default 10000000, Joi
  `min(100).max(1e8)`, mirrors `RELAYER_MAX_TX_FEE`). `soroban-offering-escrow.service.ts` asserts
  `BigInt(prepared.fee) <= BigInt(cfg.maxTxFee)` immediately after `assembleTransaction` and BEFORE
  `prepared.sign(admin)`, throwing a terminal `OfferingEscrowError` otherwise. Added to `.env`/`.env.example`.
- **287(a) individual-param attestation — DEFERRED (risk-accepted).** Snapshotting `total_supply` +
  both retention amounts would need a migration + 3 columns for a currently-**unexploitable** path: an
  offering can only be approved once its `fraction_contracts` row is `deployed`, and that row is immutable
  thereafter (only `status`/`tx_hash` transition during the deploy CAS), so there is no live mutation window
  between approval and escrow deploy. The `public_float` belt already catches any supply/retention change
  via the derived difference. **Revisit only if `fraction_contracts` economic columns ever become mutable
  post-deploy** (e.g. a future re-fractionalize/amend path) — at which point snapshot the tuple individually.
- Build + lint green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review. Two security-sentinel LOW/P3 defense-in-depth
  items on the escrow money path; both theoretical under the current immutable-`fraction_contracts`
  invariant, no live exploit.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
