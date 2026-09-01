---
status: complete
priority: p3
issue_id: 304
tags: [code-review, security]
dependencies: []
---
# Failed escrow jobs retain the passkey assertion in Redis for 24h

## Problem Statement
The BullMQ job payload carries the raw passkey assertion (`signature`, `authenticatorData`, `clientDataJSON`, `boundPublicKey`, `txXdr`) — a bearer credential. On terminal/exhausted failure it's retained 24h (`removeOnFail: { age: 86400 }`). The assertion is nonce+expiry-bound (~200s validity) and only authorizes moving the collector's OWN funds into escrow, so practical replay value is low (requires Redis compromise), but retaining an authorization credential 24h past its ~200s usefulness is unnecessary exposure on a money queue.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:~207` — `removeOnFail: { age: 86400 }`.
- `src/modules/offerings/bids/offering-bid-escrow.job.ts:9-25` — payload holds the assertion fields.

## Proposed Solutions
### Option A — Drop the failed-job retention window on this queue
- Description: Set `removeOnFail: true` (or a few-minutes `age`) for the escrow queue. The audit row already records the failure reason without the assertion, so nothing operationally needed is lost.
- Pros: Removes the credential from Redis at/near failure; trivial change; failure diagnosis unaffected (audit retains reason).
- Cons: Slightly less raw job history for ad-hoc queue inspection.
- Effort: Small
- Risk: Low

### Option B — Encrypt the assertion fields at rest
- Description: If the queue TTL must stay long for ops reasons, encrypt the assertion fields in the payload (wrap under the existing KEK infra) so a Redis dump does not yield a usable credential.
- Pros: Keeps long retention while removing the plaintext-credential exposure.
- Cons: More moving parts (encrypt/decrypt in the worker), key management on the queue path.
- Effort: Medium
- Risk: Low

## Recommended Action

## Technical Details
The assertion is only usable within its on-chain validity window (~200s), so the 24h retention is exposure far past any legitimate use. Option A aligns the Redis lifetime with the credential's actual usefulness; the audit row (written on failure) is the durable record of what happened.

## Acceptance Criteria
- The signed assertion is not retained in Redis meaningfully past its on-chain validity window.
- The failure reason is still recorded (audit) for diagnosis.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Changed the escrow queue's `removeOnFail` from `{ age: 86400 }` (24h) to `{ age: 300 }` (5 min) in
`offering-bids.service.ts`. A failed job's passkey assertion (a bearer credential valid only ~120 ledgers /
~10 min) is now dropped from Redis shortly after it can no longer be used, instead of lingering for 24h.
The failure reason is preserved in the `BID_ESCROW_FAILED` audit row (which carries no assertion bytes), so
observability is unaffected. Build green.
