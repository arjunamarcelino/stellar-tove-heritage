---
status: complete
priority: p3
issue_id: 272
tags: [code-review, security, data-integrity, documentation, TOV-241, PR-37]
dependencies: []
---

# Document that `isAllowed` is an advisory, non-authoritative mirror (not for authz) + existence-oracle note

## Problem Statement
Two related, documented-but-not-surfaced properties of the response:

1. **Non-authoritative / can be wrong.** The mirror is advanced only by *this system's confirmed mutations*; `noop` reads skip it, `pending`-then-confirmed txs and any out-of-band on-chain change (another admin key / multisig / direct contract call) are never reflected. So `isAllowed:false` can be a stale false-negative (and `true` a stale false-positive after an out-of-band removal). If any UI or downstream ever treats this endpoint's `isAllowed` as an authorization/eligibility decision rather than a display hint, it makes a wrong security call.

2. **Existence oracle.** Beyond `isAllowed`, the body leaks whether a wallet has *ever* been processed (never-seen → `lastAction:null`; touched → non-null provenance + `updatedAt` = admin operation timing). Admin-only + on-chain-public data mitigates this, but it's a real enumeration signal the `{isAllowed:false}` contract was partly meant to blunt.

## Findings
Flagged by **security-sentinel (P3 ×2)**, **data-integrity-guardian (P3)**, and noted by **architecture-strategist**.
- `src/modules/kyc-allowlist/repositories/kyc-allowlist-state.repository.ts:24-25`, entity docblock (advisory).
- `backoffice-kyc-allowlist.service.ts:225-227` (noop skips mirror), `~:228-241` (only confirmed writes).
- `dto/kyc-allowlist-status-response.dto.ts:32-40,9-10` (provenance leaks seen/timing).

## Proposed Solutions
1. **Document only** — add "advisory / not for authz — read `tx.isAllowed(wallet)` on-chain if a trustworthy value is needed" to the `isAllowed` `@ApiProperty` description and the endpoint `@ApiOperation`; note the eventual-consistency + existence-oracle in the API description so consumers don't treat `isAllowed:false` as authoritative. Pros: cheap, matches the accepted design; Effort: Small.
2. **Collapse provenance for never-seen vs not-allowed** — return provenance `null` unless truly needed, so never-seen and seen-but-not-allowed are indistinguishable. Pros: closes the oracle. Cons: removes the enriched provenance that was a deliberate product decision; Effort: Small. (Likely rejected — conflicts with the enriched-body choice.)
3. **On-chain read for a trustworthy value** — out of MVP scope; only if a real authz consumer appears.

## Recommended Action
**RESOLVED — Solution 1 (document only).** The `isAllowed` `@ApiProperty` description now states it is an
ADVISORY, display-only mirror, NOT an authorization signal (can lag / miss out-of-band on-chain changes; read
`is_allowed` on-chain if a trustworthy value is needed). The endpoint `@ApiOperation` description states the
eventual-consistency, the 200-not-404 contract (404 intentionally excluded), and the provenance existence-oracle
note. Provenance is retained (Solution 2 rejected — it conflicts with the deliberate enriched-body decision).

## Technical Details
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-status-response.dto.ts` (`isAllowed` description).
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts` (`@ApiOperation` description).

## Acceptance Criteria
- [x] `isAllowed` field doc states advisory / not-for-authz.
- [x] Endpoint description notes eventual-consistency, 200-not-404, and the existence-oracle.
- [x] Build clean (Swagger-text-only change).

## Work Log
- 2026-08-18: created from PR #37 review (security-sentinel, data-integrity-guardian, architecture-strategist).
- 2026-08-18: RESOLVED — advisory/not-for-authz + eventual-consistency + oracle documented in DTO field + endpoint Swagger. Build green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
