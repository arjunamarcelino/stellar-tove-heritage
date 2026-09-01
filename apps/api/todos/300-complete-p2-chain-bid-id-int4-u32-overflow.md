---
status: complete
priority: p2
issue_id: 300
tags: [code-review, data-integrity, correctness]
dependencies: []
---
# chain_bid_id is int4 but stores a contract u32 → overflow strands a bid with funds escrowed

## Problem Statement
The contract's `submit_bid` returns a u32 bid id (max 4,294,967,295), decoded via `Number(scValToBigInt(...))`, but the column is PG `integer` (int4, max 2,147,483,647). A bid id > 2^31-1 makes `casEscrowed` fail with numeric-out-of-range (22003) on the SUCCESS path — after funds have already moved on-chain — so the row stays `submitted` while retries re-simulate-fail into terminal `failed` (a stranded state, cf. todo 293). Realistically bid ids are small per-offering sequential values, so the likelihood is very low, but the column domain is narrower than the wire type, which is a latent correctness/data-integrity mismatch.

## Findings
- `src/database/migrations/1716000000036-CreateOfferingBidsTable.ts:~40` — `"chain_bid_id" integer` (int4, max 2,147,483,647) while the wire type is u32 (max 4,294,967,295).
- `src/modules/offerings/entities/offering-bid.entity.ts:~53` — column declared `type: 'int'`, matching the narrow int4 domain.
- `src/modules/relayer/soroban-relayer.service.ts:~665` — `Number(scValToBigInt(resp.returnValue))`, JSDoc documents a "u32 bid id"; a decoded value in (2^31-1, 2^32-1] would exceed the int4 column and raise 22003 on the success CAS.
- Scenario: contract returns a bid id above 2,147,483,647 → `casEscrowed` INSERT/UPDATE fails with `22003` numeric-out-of-range AFTER the on-chain escrow transfer succeeded → row remains `submitted`; subsequent retries re-simulate and fail into terminal `failed`, leaving a bid whose funds are escrowed on-chain but whose DB state is terminal/stuck.

## Proposed Solutions
### Option A — Widen the column to bigint
- Description: Change `chain_bid_id` to PG `bigint`, type the entity field as `string` (per the numeric→string money discipline used elsewhere), and keep the `CHK_bid_chain_id_positive` check constraint. Since migration 036 is not yet applied to shared DBs, add a follow-up migration or amend 036 if still unshipped.
- Pros: Fully covers the entire u32 domain; no runtime rejection path; aligns storage type with the wire type.
- Cons: Requires a migration change/coordination; entity field becomes a string, touching any code that reads it as a number.
- Effort: Small
- Risk: Low

### Option B — Bound-assert the decoded id before the CAS
- Description: After decoding, assert `id > 0 && id <= 2^31-1`; if out of range, treat it as an explicit terminal failure (with a distinct error) rather than letting the CAS raise 22003 post-escrow.
- Pros: Cheapest; converts a silent numeric-overflow into an explicit, observable terminal decision.
- Cons: Keeps the narrow int4 domain; still cannot store a legitimately large u32 id — it just fails cleanly instead of storing it.
- Effort: Small
- Risk: Low-Medium (a valid large id is still unstorable)

### Option C — Do nothing (accept the latent risk)
- Description: Rely on bid ids remaining small sequential per-offering values.
- Pros: No work.
- Cons: Latent overflow remains; if it ever triggers, funds are escrowed with a stranded DB row.
- Effort: None
- Risk: Low likelihood, high impact if hit

## Recommended Action

## Technical Details
- Wire type: contract `submit_bid` → u32 (0 … 4,294,967,295).
- Storage type: PG int4 (max 2,147,483,647); overflow raises SQLSTATE `22003`.
- The failure lands on the SUCCESS path (after `casEscrowed` follows the on-chain transfer), which is why it strands rather than cleanly aborting — see the stranded-state discussion in todo 293.

## Acceptance Criteria
- A u32 bid id above the int4 max cannot cause a numeric-overflow on the success CAS.
- The decision (widen the column vs bound-assert the decoded id) is recorded on the PR/ticket.
- `yarn test` stays green.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

**Chosen:** Option A — widen the column to `bigint` (money-safe: a landed bid whose id exceeds int4 max can
now be recorded, so it's never wrongly stranded as `submitted`).

- Migration `1716000000036`: `chain_bid_id integer` → `bigint`.
- Entity `offering-bid.entity.ts`: `type:'bigint'` with a lossless `Number` transformer
  (`from: v => v==null?null:Number(v)`), so `chainBidId` stays `number` in TS (a u32 < 2^53) — no DTO/latch
  ripple. `CHK_bid_chain_id_positive` still applies.
- Applied `ALTER TABLE offering_bids ALTER COLUMN chain_bid_id TYPE bigint` to `tove_test` (036 already
  recorded there); shared DBs get the widened type when 036 runs at deploy.

**Tests:** fixed the one raw-SQL assertion (bigint → string via the pg driver → `Number(...)`). Integration
10/10, e2e 7/7, build green.
