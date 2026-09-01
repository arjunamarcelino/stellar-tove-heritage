---
status: complete
priority: p2
issue_id: 230
tags: [code-review, data-integrity, TOV-235, PR-33]
dependencies: []
---

# tx_hash never lowercased before insert; a non-lowercase hash would roll back the whole batch + drop the audit row

## Problem Statement
The DB CHECK on `tx_hash` (and `last_tx_hash`) is case-sensitive lowercase hex (`^[0-9a-f]{64}$`), but the tx hash from `@stellar/stellar-sdk`'s `sendTransaction` flows verbatim into the insert with no `.toLowerCase()`. It is lowercase in practice today, so this is latent — but the DB constraint is stricter than the code guarantees, and if a non-lowercase hash ever appears, the whole `persist()` transaction rolls back after the on-chain mutation already committed, leaving an irreversible allowlist change with no event/mirror row.

## Findings
- `src/database/migrations/1716000000029-CreateKycAllowlistTables.ts` → `CHK_kae_tx_hash` and `CHK_kas_last_tx_hash` both `~ '^[0-9a-f]{64}$'`.
- `src/modules/kyc-allowlist/soroban-kyc-allowlist.service.ts` returns `txHash: sent.hash` verbatim (confirmed + pending branches).
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts:~195` builds the event row and `~205` the mirror upsert from that value; both run inside one `runInTransaction`, so one bad field rolls back every confirmed row in the batch.

## Proposed Solutions
### Option A (recommended): lowercase at the adapter boundary
- Return `sent.hash.toLowerCase()` from `buildSignSendPoll` (both confirmed + pending). Covers both the event insert AND the mirror upsert in one place. Add a unit assertion that an uppercase-hex hash is coerced. Effort: Small.

### Option B: normalize in persist()
- Lowercase `txHash` when building `rows` + the upsert input. Effort: Small. (Prefer A so the neutral result type is already normalized.)

## Recommended Action
**RESOLVED (Option A).** `buildSignSendPoll` now returns `sent.hash.toLowerCase()` for both confirmed and pending results, so the event insert AND the mirror upsert always receive lowercase hex — the DB CHECK can no longer roll back a batch after an on-chain mutation. Added a unit test asserting an uppercase-hex hash is coerced.

## Technical Details
- Affected: `src/modules/kyc-allowlist/soroban-kyc-allowlist.service.ts` (preferred), or `backoffice-kyc-allowlist.service.ts:persist`.

## Acceptance Criteria
- [x] tx hashes are lowercased before any DB write (event + mirror).
- [x] A test proves an uppercase-hex hash does not violate the CHECK / roll back the batch.

## Work Log
- 2026-07-18: created from PR #33 review (data-integrity-guardian, rated P1 there; downgraded to P2 as latent — SDK returns lowercase today — but severe-if-triggered).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — lowercase at the adapter; unit test added.
