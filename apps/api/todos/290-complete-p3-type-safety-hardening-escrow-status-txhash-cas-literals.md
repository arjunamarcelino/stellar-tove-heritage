---
status: complete
priority: p3
issue_id: 290
tags: [code-review, typescript, type-safety, TOV-154, PR-39]
dependencies: []
---

# Type-safety hardening for the escrow status vocabulary, txHash sentinel, and CAS literals

## Problem Statement
A cluster of four type-safety hardenings around the offering-escrow deploy path. None is a live defect
today, but each is a place where the compiler is *not* backstopping a value it easily could, so a future
edit can silently drift the Swagger contract, launder a sentinel, or turn a compare-and-set (CAS) into a
permanent no-op without any type error.

## Findings
- **kieran-typescript-reviewer (P3):** four related weak spots on the escrow deploy path.

(a) **Escrow-status vocabulary has three hand-copied definitions, no single source of truth.**
`EscrowDeployStatus` (`src/modules/offerings/constants/offering-status.constant.ts` ~line 42) is a bare
string union with **no** runtime tuple, unlike its sibling `OfferingStatus`, which is derived from
`OFFERING_STATUSES` (`… as const`). Because there is no runtime array to reference, the Swagger DTO
hardcodes a **third** copy — `@ApiProperty({ enum: ['deploying','deployed','failed'] })` in
`src/modules/backoffice/offerings/dto/offering-summary.dto.ts` (~line 18) — and the migration `CHECK`
constraint is a further hand-copy. Add a value to the union and the Swagger enum silently drifts.

(b) **`txHash` typed non-nullable but uses `''` as a self-heal sentinel.** `DeployEscrowResult.txHash`
(`src/modules/offerings/escrow/offering-escrow.service.interface.ts` ~29-33) is typed `txHash: string`
and returns `''` on the self-heal path; the consumer then launders it back with `res.txHash || null`
(`src/modules/offerings/deploy/offering-escrow-deploy.processor.ts` ~line 118). The type lies about the
domain (empty string is not a tx hash) and the real intent — "no tx" — is expressed twice, informally.

(c) **CAS WHERE-clause status literals are unchecked raw SQL strings.** In
`src/modules/offerings/repositories/offering.repository.ts` (~lines 52, 73, 83, 93) the `.set({
escrowDeployStatus: 'deploying' })` side is union-checked, but the matching `WHERE … =
'deploying'` fragment is a raw string that the compiler never sees against `EscrowDeployStatus`. A typo
in the WHERE literal compiles cleanly and the CAS then **never matches** — returning `false` forever, a
silent no-op latch that would strand every affected offering with no error.

(d) **`parseStatuses` casts the needle to the type it is trying to prove.**
`src/modules/backoffice/offerings/backoffice-offerings.service.ts` (~line 327):
`!OFFERING_STATUSES.includes(p as OfferingStatus)` asserts `p` is already an `OfferingStatus` in the very
membership test meant to establish that. Widen the haystack instead.

## Proposed Solutions
### Option A — Do all four hardenings
- (a) In `offering-status.constant.ts`:
  `export const ESCROW_DEPLOY_STATUSES = ['deploying','deployed','failed'] as const;`
  `export type EscrowDeployStatus = (typeof ESCROW_DEPLOY_STATUSES)[number];`
  and have the DTO use `enum: ESCROW_DEPLOY_STATUSES` so Swagger + type share one source.
- (b) Type `txHash: string | null`; return `null` on the self-heal path
  (`soroban-offering-escrow.service.ts` ~line 116) and drop the `|| null` in the processor.
- (c) Bind the CAS status values as parameters referencing the typed union, e.g.
  `AND escrow_deploy_status = :deploying` with `{ deploying: 'deploying' satisfies EscrowDeployStatus }`,
  or introduce `satisfies`-typed locals reused on both the `.set()` and WHERE sides.
- (d) `(OFFERING_STATUSES as readonly string[]).includes(p)` — widen the haystack, no needle cast.
- **Pros:** every escrow-status value becomes compiler-checked; sentinel removed; CAS typo becomes a
  build error. **Cons:** touches four files. **Effort:** Small. **Risk:** Low.

### Option B — Prioritize the two risky ones, defer the rest
- Do (a) drift and (c) silent-no-op now; defer (b) sentinel and (d) needle-cast as cosmetic.
- **Pros:** removes the two failure-mode hazards with minimal churn. **Cons:** leaves the informal
  sentinel and the self-proving cast in place. **Effort:** Trivial. **Risk:** Low.

## Recommended Action
Prefer **Option A** (single cleanup pass). If time-boxed, **Option B** — land (a) and (c) first, since
Swagger drift and a permanent silent CAS no-op are the two outcomes a reader cannot detect at a glance.

## Technical Details
- `src/modules/offerings/constants/offering-status.constant.ts` (~line 42)
- `src/modules/backoffice/offerings/dto/offering-summary.dto.ts` (~line 18)
- `src/modules/offerings/escrow/offering-escrow.service.interface.ts` (~29-33)
- `src/modules/offerings/escrow/soroban-offering-escrow.service.ts` (~line 116)
- `src/modules/offerings/deploy/offering-escrow-deploy.processor.ts` (~line 118)
- `src/modules/offerings/repositories/offering.repository.ts` (~lines 52, 73, 83, 93)
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` (~line 327)

## Acceptance Criteria
- [x] A single `ESCROW_DEPLOY_STATUSES as const` tuple is the source of truth for the union + the Swagger enum.
- [x] CAS status literals are compiler-checked (parameter-bound to typed consts) so a typo fails the build.
- [x] `txHash` is `string | null`; the self-heal path returns `null` and the `|| null` launder is gone.
- [x] No membership test casts its needle to the type it is proving.

## Resolution (2026-08-20 — all four)
- **(a)** `offering-status.constant.ts` now derives `EscrowDeployStatus` from a runtime
  `ESCROW_DEPLOY_STATUSES = [...] as const` tuple (mirrors `OFFERING_STATUSES`); `offering-summary.dto.ts`'s
  `@ApiProperty({ enum: ESCROW_DEPLOY_STATUSES })` reuses it instead of a hand-copied array.
- **(b)** `DeployEscrowResult.txHash: string | null`; the soroban self-heal + fake return `null` (not `''`),
  and the processor persists `res.txHash` directly (dropped `|| null`).
- **(c)** `offering.repository.ts` binds the CAS WHERE status literals to typed module consts
  (`S_PLANNED`/`S_APPROVED: OfferingStatus`, `D_DEPLOYING`/`D_FAILED: EscrowDeployStatus`) via `:params` — a
  typo is now a compile error, not a silently-never-matching WHERE.
- **(d)** `parseStatuses` widens the haystack (`(OFFERING_STATUSES as readonly string[]).includes(p)`) so the
  membership test validates a real `string` instead of casting the needle.
- Build + lint + offerings unit (118) + e2e (9) green. (Migration CHECK left as raw SQL — it can't import TS;
  the existing drift-guard test pins it to the union.)

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review (kieran-typescript-reviewer, P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
