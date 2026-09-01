---
status: complete
priority: p2
issue_id: 269
tags: [code-review, typescript, test-quality, TOV-241, PR-37]
dependencies: []
---

# Service spec's `as never` casts + untyped mock rows give false-green type checks

## Problem Statement
The service unit spec constructs the SUT with four `as never` casts and untyped `getStatus` mock rows. `as never` erases the shape entirely, so the compiler checks nothing about those args; if `IdempotencyStore`, `AuditLogService`, or the event-repo contract changes, the spec keeps compiling against stale mock shapes and reports false green. Likewise the `getStatus` mock rows are plain object literals, not typed as `KycAllowlistState`, so an entity field rename wouldn't fail these tests (works today only because `fromState` reads properties structurally).

## Findings
Flagged by **kieran-typescript-reviewer (P2 + a P3)**. Good contrast in the same file: `tx` (`FakeKycAllowlistService`) and `state` (structural literal) are passed **uncast** and DO get checked.
- `test/unit/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.spec.ts:52-59` — `events as never`, `cfg as never`, `idempotency as never`, `audit as never`.
- Same file `~:210-218, 224-232` — `mockResolvedValueOnce({...})` untyped rows.

## Proposed Solutions
1. **Type each fake to its interface** — e.g. `const audit: Pick<AuditLogService,'record'> = {...}` / cast to `as IKycAllowlistEventRepository` instead of `as never`; annotate mock rows `mockResolvedValueOnce({...} satisfies KycAllowlistState)`. Pros: restores compile-time safety, catches contract drift. Cons: a little more test boilerplate; Effort: Small.
2. **Accept as-is** — unit tests are pinned to behavior, not shape; contract drift is caught by build + integration. Pros: zero effort. Cons: loses the early signal the reviewer wants; Effort: none.

## Recommended Action
**RESOLVED — Solution 1 (type the fakes), applied file-wide.** The four `as never` casts are replaced with
mocks typed to the used subset of each collaborator's interface, so a contract change now fails compilation
in the spec instead of passing against a stale shape:
- `events: Pick<IKycAllowlistEventRepository, 'append' | 'runInTransaction'>`
- `audit: Pick<AuditLogService, 'record'>` (and `audited` is now `NewAuditEntry[]`)
- `cfg: Pick<ConfigType<typeof kycAllowlistConfig>, 'contractAddress' | 'maxBatch'>`
- `idempotency` typed via the real `InMemoryIdempotencyStore` (cast `as unknown as IdempotencyStore` at the
  constructor to satisfy the full param — the shape check happens at each const's annotation).

The `getStatus` mock rows now use `satisfies KycAllowlistState`. `state` is intentionally left as an inferred
literal (its `findByWallet` must stay a `vi.fn()` so tests can `mockResolvedValueOnce` — annotating it would
erase the `Mock` type); it was already uncast and type-checked.

## Technical Details
- `test/unit/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.spec.ts`.

## Acceptance Criteria
- [x] New `getStatus` mock rows typed via `satisfies KycAllowlistState`.
- [x] The four `as never` casts replaced with interface-typed mocks (drift now fails compilation).
- [x] `tsc --noEmit -p tsconfig.json` reports **zero** errors in this spec (verified; the repo's 155 baseline
      errors are the pre-existing `supertest`/`App` typing noise shared by all e2e specs — unrelated).
- [x] Spec still green (16 tests).

## Work Log
- 2026-08-18: created from PR #37 review (kieran-typescript-reviewer P2 + P3).
- 2026-08-18: RESOLVED — interface-typed mocks replace `as never`; `satisfies KycAllowlistState` on mock rows; verified tsc-clean for this spec + green (16).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
