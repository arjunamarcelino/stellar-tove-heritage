---
status: complete
priority: p3
issue_id: 425
tags: [code-review, tov-32, pr-55, performance, config]
dependencies: []
---
# Tighten the trustline-read timeout (2000ms → ~1200ms)

## Resolution (2026-08-27)
**Applied — Option A.** Lowered the `WALLET_TRUSTLINE_TIMEOUT_MS` default `2000 → 1200` in
`wallet-trustline.config.ts` (+ clarified the comment: it's the add's P99-latency add on an RPC stall), the Joi
default in `validation-schema.ts`, and the `.env.example` value — aligning with the RFQ balance-advisor precedent
the comment already cited. Pure config; fail-open behavior unchanged. Build 0 issues; lint clean.

## Problem Statement
The BYOW trustline read is a **fail-open** RPC on the *synchronous* `POST /v1/me/wallets` response path (after the
durable bind). Its default budget is `WALLET_TRUSTLINE_TIMEOUT_MS = 2000` (`wallet-trustline.config.ts:40`). Because
the resolve is synchronous on the response, a slow/hung Soroban RPC adds up to **2000ms to the P99 latency** of the
add — even though the wallet is already durably bound and the idempotency record already completed. It cannot *fail*
the request (fail-open → a harmless spurious `change_trust` template) but it can *slow* it by the full budget on
every RPC stall.

## Findings
- performance-oracle P3: 2000ms is generous for an enrichment whose failure mode is a no-op in the wallet. The
  in-repo precedent for a fail-open read on a request path — the RFQ balance advisor — uses **~1.2s**, and the
  config comment (`wallet-trustline.config.ts:39`) even cites that precedent. Tightening to ~1000–1200ms cuts
  worst-case add latency ~40% with zero correctness cost.
- Everything else verified optimal: single round-trip (one `getLedgerEntries`, trustline key only — no account
  read), `rpc.Server` constructed once in the constructor, read is correctly sequential-after-bind, replay
  re-resolution bounded by the 5/60s throttle.

## Proposed Solutions
### Option A — Lower the default to 1200ms (Recommended)
Change the `?? '2000'` default in `wallet-trustline.config.ts:40` (and the `.env.example` value) to `1200`, aligning
with the RFQ-advisor precedent the comment already cites. Pure config, no code path change. Effort: Trivial · Risk: Low
(slightly higher chance of fail-open under a genuinely slow-but-healthy RPC — acceptable, since fail-open just emits
the template).
### Option B — Leave as-is
2000ms is within the Joi range and fail-open makes it non-fatal. Defensible if ops prefer fewer spurious prompts.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/config/wallet-trustline.config.ts:40`, `.env.example` (`WALLET_TRUSTLINE_TIMEOUT_MS`).

## Acceptance Criteria
- [ ] Timeout default reflects a deliberate choice vs. the RFQ-advisor precedent (either lowered or documented as
      intentionally higher).

## Work Log
- 2026-08-27: Filed from PR #55 review (performance-oracle P3).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/55
- Precedent: the RFQ balance advisor (~1.2s withRpcTimeout deadline).
