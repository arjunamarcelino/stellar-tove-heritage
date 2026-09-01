---
status: complete
priority: p2
issue_id: 373
tags: [code-review, performance, tov-175, pr-48]
dependencies: []
---
# `insertOpen` does a redundant re-SELECT inside the advisory-locked critical section (PR #48)

## Problem Statement
Every successful quote submit does two DB round-trips to write one row — an `INSERT ... RETURNING id` then a
separate `findOne({ where: { id } })` to hydrate server defaults/timestamps. The second query runs while the
per-`(holder, fraction_contract)` `pg_advisory_xact_lock` is still held, so it lengthens the exact critical
section the lock exists to serialize.

## Findings
Source: performance-oracle (P2).
- `src/modules/marketplace/quotes/repositories/quote.repository.ts:38` — `.returning(['id'])`.
- `src/modules/marketplace/quotes/repositories/quote.repository.ts:45` — second round-trip
  `manager.getRepository(Quote).findOne({ where: { id } })`.
- The lock is acquired at `quotes.service.ts:133` and released at txn end; `insertOpen` (`:148`) runs inside it.
- (This mirrors the TOV-172 RFQ `insertOpen`, which has the same two-step pattern — but there it is not the
  headline contention path this lock guards.)

## Proposed Solutions
### Option A — Single `INSERT ... RETURNING *` and map the raw row (Recommended)
- Replace `.returning(['id'])` + re-`findOne` with `.returning('*')` (or the explicit column list) and build
  the `Quote` from the returned row.
- Pros: removes one DB round-trip (~0.5–2ms LAN) from the locked section on every successful submit,
  shortening lock-hold time under contention.
- Cons: must map raw column names → entity fields (numeric→string, bytea→Buffer) or rely on TypeORM's
  `RETURNING` mapping; slightly more code than the re-read.
- Effort: Small · Risk: Low
### Option B — Leave as-is
- Accept the extra read; it is tiny in absolute terms and matches the RFQ precedent.
- Pros: zero change, precedent-consistent. Cons: keeps an avoidable read in the hot lock.
- Effort: None · Risk: None

## Recommended Action
Option A — the re-read is cheap in isolation but sits inside the serialized section; a single RETURNING is the
right shape here. Consider applying the same to the RFQ `insertOpen` for consistency (separate change).

## Resolution (2026-08-22, complete — Option A)
`insertOpen` now does a single `INSERT ... .returning('*')` and returns `result.generatedMaps[0]` (entity-mapped
server defaults/timestamps) — no follow-up `findOne` inside the advisory lock. **Gotcha found & handled:** on an
ON-CONFLICT DO NOTHING, TypeORM's `generatedMaps` is `[{}]` (an empty object), NOT `[]` — so the null/replay
path gates on `result.raw.length === 0` (raw IS empty on conflict), not on generatedMaps. Also applied the #379
spread cleanup here (`.values({ ...quote, status: Q_OPEN })`). The RFQ `insertOpen` was left unchanged (separate
change). Build 0; quote unit 26 / integration 13 / e2e 16 green (incl. the durable-replay conflict path).

## Technical Details
- Affected: `quote.repository.ts:insertOpen`. Verify the RETURNING→entity mapping keeps `numeric(39,0)` as
  string and `bytea` as Buffer.

## Acceptance Criteria
- [x] A successful submit performs a single INSERT round-trip inside the txn (no follow-up SELECT).
- [x] The returned `Quote` still carries the correct types (money as string, dates as Date).
- [x] Integration test still green (`insertOpen returns the row` + null-on-conflict).

## Work Log
- 2026-08-22: Filed from PR #48 review (performance-oracle P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
