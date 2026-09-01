---
status: complete
priority: p2
issue_id: 247
tags: [code-review, performance, scalability, TOV-237, PR-35]
dependencies: []
---

# O(catalog) on-chain fan-out: every caller reads every deployed contract

## Problem Statement
The number of Soroban `simulateTransaction` calls per cache-miss is proportional to the **total** deployed FractionTokens on the platform, not to the caller's holdings. A collector holding 3 of 500 artworks still triggers 500 reads. Latency and RPC load grow linearly with the catalog.

## Findings
Flagged by performance-oracle (P1.2), architecture-strategist (scalability watch), security-sentinel (P3.2 — amplification during a Redis outage: fail-open cache means up to `30/min × N` reads/user against the RPC precisely when degraded).
- `me-holdings.service.ts:54,85-90`; `soroban-fraction-read.service.ts:37-44`.
- Latency @ concurrency 8, ~150–300ms/simulate: N=200 → ~4–8s; N=500 → ~10–19s; N=1000 → ~19–38s (masked by the 30s cache in steady state, paid in full on every cold key).
- Inherent to MVP: the FractionToken has no on-chain "which tokens does wallet X hold" reverse index — cannot be fully fixed in this PR.

## Proposed Solutions
1. Raise `FRACTION_READ_CONCURRENCY` (8 → 16–24) after load-testing the RPC provider's 429 threshold. Config-only. Effort: Small (+ load test). Halves wave count.
2. Post-MVP real fix: a `holdings` projection table updated from transfer/mint events → O(caller-holdings) indexed lookup instead of O(catalog). Effort: Large; separate ticket.
3. Interim guard against outage amplification: tighten the route throttle (30→10–15/min) and/or add single-flight (see todo 248). Effort: Small.

## Recommended Action
**RESOLVED — documented deferral (user-confirmed).** The inherent O(catalog) fan-out is accepted for MVP; the real fix (an event-indexed `holdings` projection → O(caller-holdings) lookup) is recorded here as the post-MVP follow-up. Concurrency kept at 8 (no blind bump without a load test against the RPC 429 threshold). The related mitigations that DID land in this review pass: index for `findAllDeployed` (todo 246), per-wallet single-flight to collapse same-wallet stampede (todo 248), overall request budget (todo 249), and the honest `fanOutWarnThreshold` "observe the cliff" signal (todo 245). Outage amplification is bounded per-identity by the throttle + single-flight; a tighter throttle can be revisited if RPC 429s appear.

## Technical Details
- No new code under this todo; mitigations delivered via todos 245/246/248/249. Follow-up (separate ticket): event-indexed holdings table.

## Acceptance Criteria
- [x] Decision recorded: keep concurrency 8; event-indexed holdings scheduled as the post-MVP real fix.
- [x] Outage-amplification mitigation decided: per-identity throttle + single-flight (248); tighter throttle deferred.

## Work Log
- 2026-07-18: created from PR #35 review (performance P1.2, architecture, security P3.2).
- 2026-07-18: RESOLVED — documented MVP deferral; related mitigations landed under 245/246/248/249; event-indexed holdings noted as the post-MVP follow-up.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
