---
status: complete
priority: p3
issue_id: 090
tags: [code-review, database, quality, tov-20]
dependencies: []
---

# `auth_challenges.transaction_xdr` Is Persisted But Never Read (Write-Only Column)

## Problem Statement
`transactionXdr` is written on `create` but never read: `verify` re-parses the client-submitted signed XDR
and only reads `publicKey`/`expiresAt`/`consumedAt` off the row. The stored `TEXT` blob is currently dead
weight (and inflates row size, compounding the sweep concern in todo 085). This is safe — the `tx_hash`
binding already pins the transaction body — but the column serves no consumer.

## Findings
- Written: `src/modules/auth/sep10.service.ts:72` (via `create`); column `auth-challenge.entity.ts:20-21`,
  migration `:50`.
- No read of `challenge.transactionXdr` anywhere in `verify`.

## Proposed Solutions

### Option A: Drop the column + `CreateAuthChallengeInput` field
- **Description:** Remove `transaction_xdr` from entity, repo input, and migration.
- **Pros:** Smaller rows; no dead storage.
- **Cons:** Loses forensic/audit potential.
- **Effort:** Small
- **Risk:** Low

### Option B: Use it as defense-in-depth
- **Description:** On verify, compare the submitted XDR's transaction body against the stored one (bind to
  the exact issued transaction, not just its hash), or keep it explicitly for audit with a one-line comment.
- **Pros:** Slightly stronger binding / auditability.
- **Cons:** Extra check for marginal gain (hash binding already suffices).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — drop the column (user-confirmed). Migration 011 is only in this PR (not deployed), so it's a
clean removal rather than a follow-up migration.

## Implemented Solution
Removed `transaction_xdr` from the `auth_challenges` CREATE TABLE (migration 011), the `AuthChallenge`
entity (added a comment explaining why the XDR isn't stored — verify re-parses the client XDR and tx_hash
already binds the submission), `CreateAuthChallengeInput`, the `create` call in `Sep10Service.buildChallenge`,
and the unit-test fake. Verified from scratch by dropping + re-provisioning `tove_test`.

## Technical Details
- Changed: `src/database/migrations/1716000000011-AddWalletsAndAuthChallenges.ts`,
  `src/modules/auth/entities/auth-challenge.entity.ts`,
  `src/modules/auth/repositories/auth-challenge-repository.interface.ts`,
  `src/modules/auth/sep10.service.ts`, `test/unit/sep10.service.spec.ts`.

## Acceptance Criteria
- [x] `transaction_xdr` removed everywhere; no reads/writes remain (grep clean); fresh migration + unit 8/8 + e2e 7/7.

## Work Log
- 2026-07-02: Filed from PR #20 review (architecture, kieran-typescript, security note — merged, P3).
- 2026-07-02: Fixed — dropped the column across migration/entity/repo/service/test; verified fresh DB. Marked complete.
