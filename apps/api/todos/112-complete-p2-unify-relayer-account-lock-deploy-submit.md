---
status: complete
priority: p2
issue_id: 112
tags: [code-review, correctness, relayer, concurrency, naming]
dependencies: []
---

# Deploy and submit use different lock keys but share one relayer sequence; DEPLOY_LOCK token is a naming trap

## Problem Statement
`src/modules/relayer/soroban-relayer.service.ts` serializes deploy under `relayer:deploy:<pk>`
(~line 140) and submit under `relayer:submit:<pk>` (~line 315) — DIFFERENT lock keys — but both consume
the SAME relayer keypair's on-chain sequence number. A concurrent deploy + submit can each fetch the
same sequence and one hits `txBAD_SEQ`. Deploy and submit MUST contend on the SAME lock.

## Findings
- Two distinct keys derived from the same `this.relayer.publicKey()`, so they never mutually exclude:
  `relayer:deploy:<pk>` (deploy critical section) vs `relayer:submit:<pk>` (submit critical section).
- The lock token/interface is `DEPLOY_LOCK` / `IDeployLock` (`deploy-lock.interface.ts`). It now
  under-describes its actual role — it is a generic per-relayer-account send-serialization lock, not a
  deploy-only lock. A maintainer reading `IDeployLock` could reasonably add a SECOND submit lock and
  silently break mutual exclusion (which is effectively what the two-key split already does).
- Related to 111: the missing mutual exclusion is one source of the submit-path `txBAD_SEQ`.

## Proposed Solutions

### Option A: One shared lock key per relayer keypair for BOTH paths
- Use a single key such as `relayer:account:<pk>` for deploy AND submit so every sequence-consuming
  submission serializes against every other one on that keypair.
- **Effort:** Small · **Risk:** Low

### Option B: Rename the token/interface to reflect the real role
- Rename `DEPLOY_LOCK` → `RELAYER_ACCOUNT_LOCK` and `IDeployLock` → `IRelayerAccountLock`; update the
  interface doc-comment to "serializes every sequence-consuming submission (deploy AND transfer) on the
  shared relayer account (one keypair = one sequence)."
- **Effort:** Small · **Risk:** Low

## Recommended Action
**Resolved (shared key + full rename).** Both deploy and submit now use ONE shared lock key per
relayer keypair — `relayer:account:${pubkey}` — so a concurrent deploy + transfer serialize on the
shared sequence. Renamed the token/interface `DEPLOY_LOCK → RELAYER_ACCOUNT_LOCK`,
`IDeployLock → IRelayerAccountLock`, and the impls/files
`{deploy-lock.interface,in-memory-deploy-lock,redis-deploy-lock} → {relayer-account-lock.interface,
in-memory-relayer-account-lock,redis-relayer-account-lock}` (classes `InMemoryDeployLock`/`RedisDeployLock`
→ `InMemoryRelayerAccountLock`/`RedisRelayerAccountLock`), with the interface doc + `modules/CLAUDE.md`
updated. DI wiring (`relayer.module.ts`) and all tests updated.

## Technical Details
- File: `src/modules/relayer/soroban-relayer.service.ts` — deploy lock (~line 140), submit lock
  (~lines 314-316).
- File: `src/modules/relayer/deploy-lock.interface.ts` — `DEPLOY_LOCK` token + `IDeployLock` doc.
- Impls: `redis-deploy-lock.ts`, `in-memory-deploy-lock.ts`; DI wiring in `relayer.module.ts`.

## Acceptance Criteria
- [x] Deploy and submit serialize against each other (one shared lock key per relayer keypair).
- [x] Token + interface renamed to reflect the generic role, with the interface doc updated.
- [x] All impls / DI wiring / tests updated to the new token name.

## Work Log
- 2026-07-14 — Filed from PR #24 code review.
- 2026-07-14 — Fixed: shared `relayer:account:<pk>` key for both ops; full token/interface/impl/file
  rename to RELAYER_ACCOUNT_LOCK / IRelayerAccountLock / *RelayerAccountLock. Build + relayer unit
  tests (46) green.
