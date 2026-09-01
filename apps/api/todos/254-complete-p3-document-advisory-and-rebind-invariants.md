---
status: complete
priority: p3
issue_id: 254
tags: [code-review, docs, security, TOV-237, PR-35]
dependencies: []
---

# Document the advisory-only invariant + the accepted rebind cache-staleness window

## Problem Statement
Two safety properties are correct in the code but only implicitly documented; writing them down prevents a future footgun (a Sell flow trusting a cached balance) and confirms an intentional design choice.

## Findings
Flagged by security-sentinel (P2-1, P3-1) and data-integrity-guardian (P2). Both concluded: no defect, no leak — document the intent.
1. **Advisory-only.** `freeBalance`/`lockedBalance` are a 30s-cached display value; the Sell/RFQ **settlement** path must re-read on-chain balance and never authorize a transfer from this cached number. Not stated on `HoldingDto.freeBalance` (`dto/holding.dto.ts:43`) — the exact field a Sell flow would be tempted to trust.
2. **Rebind staleness.** The cache keys on the server-resolved wallet address (`holdings-cache.ts:41-43`), NOT `userId`. This already sidesteps the classic "stale after primary reassignment" bug (a primary switch resolves the new address → new key) — no cross-user/cross-wallet leak. The only residual is a ≤30s address-scoped stale window if a wallet is demoted then re-promoted within the TTL. There is no `DEL`/invalidation on primary reassignment (confirmed) and none is strictly required.

## Proposed Solutions
1. Add one line to the `freeBalance` `@ApiProperty` description and/or the `HoldingsCache` header: "advisory/display only; settlement MUST re-read on-chain — never authorize a transfer from this value." Add one sentence to the module doc noting the cache is address-scoped by design (≤TTL staleness tolerated). Effort: trivial (docs).
2. Optional: best-effort `del(me:holdings:{oldAddr})` in the set-primary / auto-promote paths — but NOT as a correctness dependency. Only if product wants immediacy.

## Recommended Action
**RESOLVED — Solution 1 (docs).** Added the advisory-only invariant to `HoldingDto.freeBalance`'s `@ApiProperty` description ("display-only; settlement MUST re-read on-chain — never authorize a transfer from this value") and documented the deliberate address-keying + accepted ≤TTL rebind staleness window in the `HoldingsCache` header. No best-effort DEL added (option 2 not needed — no leak, bounded window). The lockup-side advisory note also lives on `artistLockedAmount` via todo 244.

## Technical Details
- `dto/holding.dto.ts` (freeBalance), `holdings-cache.ts` (header). Docs-only.

## Acceptance Criteria
- [x] Advisory-only invariant documented at the DTO boundary.
- [x] Address-scoped cache semantics + accepted rebind window documented.

## Work Log
- 2026-07-18: created from PR #35 review (security-sentinel, data-integrity-guardian).
- 2026-07-18: RESOLVED — invariants documented on the DTO + cache; build green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
