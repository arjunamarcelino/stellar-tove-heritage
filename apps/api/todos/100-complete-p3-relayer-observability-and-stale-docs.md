---
status: complete
priority: p3
issue_id: 100
tags: [code-review, observability, tov-21]
dependencies: []
---

# Relayer Deploy: txHash Never Recorded + Stale Comment + Untyped `verification`

## Problem Statement
Small observability + readability gaps around the relayer deploy.

## Findings
1. **`txHash` produced but never consumed.** `DeployPasskeyWalletResult.txHash` is returned by the
   adapter but `finish` reads only `contractAddress`; the tx hash is never logged, persisted, or
   returned. A real, fee-spending on-chain deploy leaves no tx hash anywhere — an observability gap.
   — `src/modules/relayer/soroban-relayer.service.ts:112`, `src/modules/auth/passkey.service.ts:158`
2. **Stale comment.** `soroban-relayer.service.ts:22` says "max attempts derived from it," but the
   poll loop is deadline-driven (`Date.now() + deployTimeoutMs`), no `maxAttempts` variable exists.
3. **Untyped evolving-`any`.** `let verification;` (`passkey.service.ts:94`) — compiles/narrows fine
   today, but a future edit before the assignment guard would silently lose type safety. Annotate
   with `Awaited<ReturnType<typeof verifyRegistrationResponse>>` or make it `const` in the `try`.
- Flagged by code-simplicity-reviewer (#1), performance-oracle, kieran-typescript-reviewer.

## Proposed Solutions

### Option A (recommended)
- Log `txHash` (and contractAddress) on the successful-deploy line in `passkey.service.ts` — or drop
  `txHash` from the port if truly unwanted (prefer logging: a deploy with no tx hash is unauditable).
- Fix the stale comment to say the loop is deadline-bounded.
- Annotate `verification`.
- **Effort:** Small · **Risk:** Low

## Recommended Action
_(triage)_

## Technical Details
- Files: `src/modules/relayer/soroban-relayer.service.ts`, `src/modules/auth/passkey.service.ts`, `src/modules/relayer/relayer.service.interface.ts`.

## Acceptance Criteria
- [ ] A successful deploy logs the tx hash (or `txHash` is removed from the port).
- [ ] The relayer poll-loop comment matches the deadline-driven implementation.
- [ ] `verification` has an explicit type.

## Work Log
- 2026-07-02: Filed from PR #21 code review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-02: RESOLVED — log tx hash on successful deploy (auditable); fixed the deadline-driven poll comment; annotated `verification: VerifiedRegistrationResponse`. Build+lint+tests green.
