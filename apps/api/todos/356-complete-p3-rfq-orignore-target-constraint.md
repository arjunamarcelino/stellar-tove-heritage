---
status: complete
priority: p3
issue_id: 356
tags: [code-review, data-integrity, tov-172]
dependencies: []
---
# `insertOpen` uses an untargeted `.orIgnore()` — a future unique constraint could be silently read as an idempotency replay (PR #46)

## Problem Statement
`RfqRepository.insertOpen` uses `.orIgnore()` (ON CONFLICT DO NOTHING for **any** unique/exclusion constraint).
Today `UQ_rfqs_idem (collector_sub, idempotency_key_hash)` is the only realistic conflict (the PK is
`gen_random_uuid`), so a `null` result unambiguously means an idempotency hit → replay. But if a future migration
adds another unique constraint to `rfqs` (e.g. a one-open-per-artwork rule), a conflict on THAT constraint would
also return `null` and be silently reinterpreted as an idempotency replay of the wrong row.

## Findings
Source: data-integrity-guardian (P3).

- `src/modules/marketplace/rfqs/repositories/rfq.repository.ts:31` (`.orIgnore()`)

## Proposed Solutions
### Option A — Target the conflict explicitly
- Description: Replace `.orIgnore()` with an explicit `ON CONFLICT ("collector_sub","idempotency_key_hash") DO NOTHING`
  (via `.orIgnore('("collector_sub","idempotency_key_hash")')` or the raw conflict-target form the query builder
  supports), so only the idempotency belt maps to the replay path; any other constraint violation throws.
- Pros: Future-proofs the replay semantics; makes intent explicit.
- Cons: Slightly more verbose; must confirm the TypeORM `.orIgnore(target)` syntax.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — target the conflict explicitly. Approved 2026-08-21.

## Resolution
Changed `insertOpen` from bare `.orIgnore()` to `.orIgnore('("collector_sub", "idempotency_key_hash")')`, which
TypeORM renders as `ON CONFLICT ("collector_sub", "idempotency_key_hash") DO NOTHING` — Postgres infers the
`UQ_rfqs_idem` unique index. Now only an idempotency-key collision maps to the replay path; any future-added
unique constraint on `rfqs` would throw instead of being silently reinterpreted as a replay. Updated the repo
+ interface comments. Verified: build 0, RFQ integration 6/6 (the idem-conflict→null test still passes).

## Technical Details
- Verify the exact `.orIgnore()` conflict-target signature in this TypeORM version; add an integration assertion
  that a non-idem unique violation (once one exists) throws rather than returning null.

## Acceptance Criteria
- [ ] `insertOpen` conflict handling is scoped to `UQ_rfqs_idem` only.
- [ ] Integration tests still pass (idem conflict → null → replay).

## Work Log
- 2026-08-21 — Filed from PR #46 review (data-integrity-guardian).

## Resources
- PR #46; `rfq.repository.ts`.
