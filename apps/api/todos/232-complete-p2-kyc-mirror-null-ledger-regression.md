---
status: complete
priority: p2
issue_id: 232
tags: [code-review, data-integrity, TOV-235, PR-33]
dependencies: []
---

# Monotonic mirror upsert: `OR EXCLUDED.last_ledger IS NULL` lets a null-ledger write regress a known-newer row

## Problem Statement
The `kyc_allowlist_state` upsert advertises "a late-arriving stale write can never regress the mirror," but its `ON CONFLICT` guard unconditionally applies any write whose incoming `last_ledger` is NULL — the opposite of monotonic-safe. Today every caller supplies a ledger (confirmed results always carry one), so the branch is dormant, but the interface permits `lastLedger: number | null` and the column is nullable, so it's a latent foot-gun that contradicts the stated invariant.

## Findings
- `src/modules/kyc-allowlist/repositories/kyc-allowlist-state.repository.ts:34-36`:
  ```sql
  WHERE "kyc_allowlist_state"."last_ledger" IS NULL
     OR EXCLUDED."last_ledger" IS NULL          -- <-- unknown incoming ledger overwrites a known one
     OR EXCLUDED."last_ledger" > "kyc_allowlist_state"."last_ledger"
  ```
- `KycAllowlistStateUpsert.lastLedger` is `number | null`; only `status==='confirmed'` calls it today (always a ledger), so not currently reachable — but the guarantee is stated as absolute.

## Proposed Solutions
### Option A (recommended): treat unknown incoming ledger as non-advancing
- Drop `OR EXCLUDED."last_ledger" IS NULL`; keep `existing.last_ledger IS NULL OR (EXCLUDED.last_ledger IS NOT NULL AND EXCLUDED.last_ledger > existing.last_ledger)`. Effort: Small.
- Add an integration case: existing `last_ledger=150`, incoming `null` must NOT flip `is_allowed`.

## Recommended Action
**RESOLVED (aggressive per user).** Removed the monotonic `WHERE` guard entirely (not just the null clause) and renamed `upsertForward` → `upsert` (plain last-write-wins). All writes come from confirmed submissions serialized under the account lock in ledger order, so an older-ledger write can never arrive after a newer one — the guard was moot. This also resolves the null-ledger regression foot-gun. Integration test updated to assert last-write-wins.

## Technical Details
- Affected: `src/modules/kyc-allowlist/repositories/kyc-allowlist-state.repository.ts`.

## Acceptance Criteria
- [x] N/A — monotonic guard removed; writes are serialized in ledger order so regression is unreachable.
- [x] Integration test updated to last-write-wins upsert.

## Work Log
- 2026-07-18: created from PR #33 review (data-integrity-guardian P2).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- See todo 234: the monotonic guard may be simplifiable/removable if the mirror stays write-only + serialized.
- 2026-07-18: RESOLVED — guard removed (aggressive); upsertForward→upsert; tests green.
