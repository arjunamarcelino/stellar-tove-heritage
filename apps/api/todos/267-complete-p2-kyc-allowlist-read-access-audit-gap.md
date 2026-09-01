---
status: complete
priority: p2
issue_id: 267
tags: [code-review, security, compliance, audit, TOV-241, PR-37]
dependencies: []
---

# KYC-allowlist status reads leave no audit trail

## Problem Statement
`GET /api/backoffice/v1/kyc/allowlist/:wallet` (`getStatus`) reads a wallet's KYC/allowlist standing and returns it with **no audit row**, whereas the mutation path (`process` → `persist`) writes an `AuditLogService.record(...)` entry. Reading a person's compliance status is itself an auditable event for a KYC/AML surface (SOC2 / access-audit expectation): the wallet→KYC-signal correlation is the sensitive artifact, even though the underlying tx-hash/ledger are on-chain-public. A compromised or curious ADMIN token can iterate addresses and harvest each wallet's allowlist membership with zero record of who queried what or when.

## Findings
Flagged by **security-sentinel (P2)** and acknowledged by **architecture-strategist (P3, deferral)**.
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts:61-64` — `getStatus(wallet)` reads + maps, no audit.
- Contrast the write path: `persist` (~`:242-261`) records `AUDIT_KIND.KYC_ALLOWLIST_PROCESSED`.
- **Wiring caveat:** `getStatus(wallet)` currently takes only `wallet`; the controller does not forward `admin.sub` (unlike `processBatch`, which passes `admin.sub`). Adding an audit row also requires threading the admin identity into `getStatus`.
- The plan (`docs/plans/2026-08-18-…-plan.md`, Security & Compliance section) consciously deferred this to a "platform-wide access-logging control" — this todo tracks that decision explicitly.

## Proposed Solutions
1. **Per-read audit row** — emit a lightweight `AuditLogService.record({ kind: 'kyc.allowlist.read', subjectType: 'kyc_allowlist_wallet', subjectId: wallet, actorSub: admin.sub })` in `getStatus`. Thread `admin.sub` from the controller. Pros: complete trail, matches the write path. Cons: one audit write per pill render (volume); Effort: Small.
2. **Sampled / aggregate access log** — structured log line (not an audit row) with `admin.sub + wallet + ts`, or aggregate counters, to avoid per-read DB writes. Pros: cheap. Cons: weaker forensic trail; Effort: Small.
3. **Platform-wide access-logging control** — defer to a cross-cutting interceptor/middleware that logs all backoffice reads of compliance surfaces (not a one-off on this route). Pros: consistent, DRY. Cons: larger scope, not this PR; Effort: Large.

## Recommended Action
**RESOLVED — Solution 1 (per-read audit row), fail-closed.** Every `getStatus` read writes a
`kyc.allowlist.read` audit row (`actorType:'admin'`, `actorId: admin.sub`) via the neutral
`AuditLogService`, awaited with no manager (own autocommit) so a compliance read is never silently served
unlogged — consistent with the write path's atomic audit. `admin.sub` is threaded from the controller via
`@CurrentUser()`.

**Schema constraint handled (user decision):** `internal_audit_log.subject_id` is `uuid NOT NULL`, but a
wallet is a StrKey (`C…`). Rather than migrate the shared append-only audit table, `subject_id` is a
deterministic **UUIDv5 derived from the wallet** (new `src/common/utils/uuid-v5.util.ts`, RFC-4122 SHA-1,
golden-vector tested), so the `(subject_type, subject_id)` index still groups all reads of a given wallet;
the raw StrKey is stored in `payload.wallet` for human queryability (`payload = { wallet, isAllowed, seen }`).

## Technical Details
- `src/modules/wallets/audit/audit-log.types.ts` — new `AUDIT_KIND.KYC_ALLOWLIST_READ = 'kyc.allowlist.read'`.
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts` — `getStatus(wallet, adminSub)` writes the audit row; module-level `KYC_ALLOWLIST_WALLET_AUDIT_NS` namespace.
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts` — threads `@CurrentUser() admin.sub`.
- `src/common/utils/uuid-v5.util.ts` (+ `test/unit/common/uuid-v5.util.spec.ts`) — generic v5 helper.
- Tests: service-unit audit-row case, e2e audit-row assertion (`internal_audit_log`), uuid golden-vector.

## Acceptance Criteria
- [x] A decision is recorded (per-read audit row, fail-closed).
- [x] Reads emit `{ actor admin.sub, wallet, timestamp }`; `admin.sub` threaded into `getStatus`.
- [x] Subject-id schema constraint resolved without migrating the shared audit table (derived v5 uuid).
- [x] Unit + e2e green (unit 55, e2e 19).

## Work Log
- 2026-08-18: created from PR #37 review (security-sentinel P2; architecture-strategist P3 deferral).
- 2026-08-18: RESOLVED — per-read fail-closed audit row; derived v5-uuid subject_id (user-confirmed) + wallet in payload; new uuidV5 util (golden-vector tested). Build + unit(55) + e2e(19) green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
- Plan `docs/plans/2026-08-18-feat-kyc-allowlist-wallet-status-read-endpoint-plan.md` (Security & Compliance)
