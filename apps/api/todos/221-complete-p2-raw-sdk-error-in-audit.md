---
status: complete
priority: p2
issue_id: 221
tags: [code-review, security, audit, TOV-233, PR-32]
dependencies: []
---

# Terminal deploy failure persists raw String(err) SDK error into the append-only audit log

## Problem Statement
On a terminal deploy failure, the raw `String(err)` of a Stellar SDK error is persisted forever into the append-only `internal_audit_log`. Stellar SDK errors can carry XDR blobs, RPC bodies, transaction envelopes/auth payloads, and internal RPC URLs — a durable, un-redactable capture in a money-adjacent audit trail.

## Findings
- `src/modules/fractionalization/deploy/fraction-deploy.processor.ts` ~line 90 `latchFailed(row.id, row.artworkId, String(err))` → audit `payload:{reason}` (~line 133) persisted forever in `internal_audit_log` (append-only, un-deletable by design).
- `String(err)` on a `@stellar/stellar-sdk` error can include XDR blobs, RPC response bodies, and in some paths the transaction envelope/auth payload + internal RPC URLs — durable, un-redactable capture in a money-adjacent audit trail.
- The client-facing `AllExceptionsFilter` genericizes non-HTTP errors, so this leaks only to DB/audit readers, not API clients.

## Proposed Solutions
### Option A (recommended): store a bounded, sanitized reason
- Store an error CODE/enum + truncated message — never the full SDK error string.
- **Effort:** Small.

## Recommended Action
**RESOLVED (Option A).** Terminal deploy failures now persist a bounded, single-line reason via a `sanitizeReason(err)` helper — `"<ErrorName>: <collapsed-whitespace message>"` truncated to 200 chars — instead of the raw `String(err)`. This keeps XDR blobs, RPC response bodies, tx envelopes/auth payloads, and internal RPC URLs out of the append-only, un-redactable `internal_audit_log`. The full raw error is still logged transiently via the `UnrecoverableError` thrown to BullMQ (ephemeral logs, not durable audit).

## Technical Details
- Affected: `src/modules/fractionalization/deploy/fraction-deploy.processor.ts` (~line 90 `latchFailed`, ~line 133 audit `payload:{reason}`).
- `internal_audit_log` is append-only (no UPDATE/DELETE), so the capture is permanent and cannot be redacted after the fact.

## Acceptance Criteria
- [ ] The persisted reason is a bounded error code/enum + truncated message, not the full SDK error string.
- [ ] No XDR blob, RPC body, transaction envelope/auth payload, or internal RPC URL can reach the audit log.

## Work Log
- 2026-07-18: created from PR #32 review

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/32
- 2026-07-18: RESOLVED — audit persists a sanitized bounded reason; build green.
