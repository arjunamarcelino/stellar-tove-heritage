---
status: complete
priority: p3
issue_id: 234
tags: [code-review, simplicity, yagni, TOV-235, PR-33]
dependencies: []
---

# YAGNI/simplification bundle for the KYC allowlist feature

## Problem Statement
Several bits of read-side scaffolding and duplicated plumbing are dead weight in 03a (the endpoint reads the chain live, never the mirror/event tables). None affect correctness; grouping the low-risk simplifications. Do NOT touch correctness-critical machinery (idempotency-before-reads, append-only trigger, serial-submit-under-lock, StrKey checksum, golden-vector encoding).

## Findings
1. **Mirror is write-only in this PR.** `state.findByWallet` has no production caller (only the integration test + fake). Nothing reads `kyc_allowlist_state`; classification uses the live `is_allowed`. The read side + monotonic `last_ledger` guard feed a table no 03a code consumes. (`kyc-allowlist-state.repository.ts`, `-state-repository.interface.ts`) — *keep the table + upsert (issue-mandated), but the reader is unused.* See also todo 232.
2. **Event `findByWallet` is test-only.** `KycAllowlistEventRepository.findByWallet` has no production caller (only `kyc-allowlist.repository.integration.spec.ts`). (`kyc-allowlist-event.repository.ts:24-26` + interface.)
3. **`deferred` + `BATCH_DEADLINE_MS` double-deferral.** The first `pending` already sets `stopped=true` and defers the rest; the wall-clock deadline is a second, overlapping trigger reachable only in a narrow corner (full 10-item batch of slow-but-confirming txs). (`backoffice-kyc-allowlist.service.ts:112-134`, `constants.ts:26`.) Overlaps with todo 231 — decide: fix the deadline (231 Option A) OR remove it (this).
4. **Quadruple wallet validation.** `wallet` carries `@IsString` + `@Matches(/^C[A-Z2-7]{55}$/)` + `@Validate(IsStrKeyContract)`; `IsStrKeyContract` (CRC16) already subsumes the first two. Plus the DB CHECK and `walletToScVal` re-validate. `@IsString`/`@Matches` only change the error message. (`kyc-allowlist-item.dto.ts:30-32`.)
5. **Inert `@Index('IDX_kae_batch')`** on the entity (`kyc-allowlist-event.entity.ts:16`) does nothing under project-wide `synchronize:false`; the migration already creates it. No other entity in this PR carries an `@Index`, so it's inconsistent as well as dead.
6. **Dead + subtly-wrong exported type.** `export type KycAllowlistConfig = ReturnType<typeof kycAllowlistConfig>` (`kyc-allowlist.config.ts:42`) has zero references and resolves to the base `cfg` type WITHOUT the non-enumerable `adminSecret` (which only exists on the `as ... & { adminSecret }` cast). Delete it or make it `ConfigType<typeof kycAllowlistConfig>`. (Matches the fraction precedent's unused alias.)
7. **Unit/e2e test overlap.** The e2e re-covers orchestration branches the unit spec already proves via the same fake (add/remove/mixed/all-noop/replay/mismatch). E2E's unique value is authz/validation-pipe cases + real DB-row assertions; the duplicated branch cases could be trimmed.

## Proposed Solutions
- Remove unused read methods (#1 reader, #2) until a read surface lands; keep the write path + table.
- Resolve #3 with todo 231 (one deferral mechanism, not two).
- Drop `@IsString`/`@Matches` (#4), keeping `@Validate(IsStrKeyContract)`.
- Delete the inert `@Index` (#5) and the dead type export (#6).
- Trim e2e branch redundancy (#7), keep authz/validation + DB-row cases.
- Effort: Small each; ~70-90 LOC total.

## Recommended Action
**RESOLVED (aggressive, per user).** Applied:
- Removed `findByWallet` from the event repo + interface and the state repo + interface (unused in 03a); integration test reads switched to raw SQL.
- State repo simplified to just `upsert` (dropped the now-unused `DataSource`/`repo` field).
- Removed the inert `@Index('IDX_kae_batch')` entity decorator (migration owns indexes under synchronize:false).
- Removed the dead + subtly-wrong exported `KycAllowlistConfig` type.
- Dropped the redundant `@IsString`/`@Matches` on `wallet` (kept `@Validate(IsStrKeyContract)` which subsumes them).
- Double-deferral (#3) resolved in todos/231 (BATCH_DEADLINE_MS removed); monotonic guard (#1 tail) in todos/232.
- **Kept** the e2e branch cases (#7): they assert real DB rows + authz/validation through HTTP, which the unit layer doesn't; the coverage value outweighs the overlap.

## Technical Details
- Affected: repositories/interfaces, entity, DTO, config, constants, e2e spec (all under `src/modules/kyc-allowlist/**`, `src/modules/backoffice/kyc-allowlist/**`, `test/`).

## Acceptance Criteria
- [x] No unused production read methods remain (findByWallet removed from both repos).
- [x] One deferral mechanism (pending stop-latch); BATCH_DEADLINE_MS removed (todos/231).
- [x] Build + lint + unit(44)/integration(8)/e2e(12) green.

## Work Log
- 2026-07-18: created from PR #33 review (code-simplicity-reviewer + kieran-typescript-reviewer).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- Related: todo 231 (deadline), todo 232 (monotonic guard).
- 2026-07-18: RESOLVED — aggressive trims applied; e2e coverage retained; all green.
