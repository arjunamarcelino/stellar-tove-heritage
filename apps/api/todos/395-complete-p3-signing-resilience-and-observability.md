---
status: complete
priority: p3
issue_id: 395
tags: [code-review, tov-189, pr-50, performance, reliability, observability]
dependencies: [393]
---
# Signing path: abort-on-timeout, aggregate backpressure, and log context

## Problem Statement
The per-asset signing path is correct (parallel, per-call 800ms timeout, fail-open) but its resilience
under an upstream (Supabase) slowdown and its diagnosability can be improved. All P3 hardening.

## Findings
1. **Timeout abandons the in-flight request instead of aborting it.** `artworks.service.ts:76-82` —
   `Promise.race([createTemporaryUrl(...), timeout])` resolves `null` when the timer wins, but the
   underlying `createSignedUrl` fetch keeps running (no `AbortController`/`AbortSignal` threaded through
   the port). During a slow-Supabase period (exactly when the timeout fires), abandoned requests keep
   holding outbound sockets until Supabase responds; combined with the fan-out this accumulates sockets
   faster than they drain. The timeout protects latency but not resource usage. (performance)
2. **No aggregate backpressure / circuit breaker.** `artworks.service.ts:58-70` +
   `artworks.controller.ts:29` — the only limiter is the per-IP 20/min throttle; there is no global
   concurrency cap or breaker on outbound signing. Under a Supabase degradation, distributed callers
   (each within 20/min) collectively saturate the outbound agent / Supabase rate limit and degrade the
   flagship anonymous browse. Bounded per-request, not backstopped in aggregate. (security/performance)
3. **Fail-open logs lack asset context.** `artworks.service.ts:79,82` — the warn lines omit the
   path/artwork id. Because `signAll` silently drops failed URLs (fewer elements than exist), a
   production "missing image" can't be traced to which key failed. Logging at least the artwork id (path
   has a mild info-leak tradeoff) would aid diagnosis. (observability)

## Proposed Solutions
### Option A — Thread an AbortSignal + add asset-id logging (Recommended for 1 & 3)
- Give the port an optional `AbortSignal`; abort the fetch when the timeout fires so slow signs shed
  load instead of piling up. Include the artwork id in the fail-open warn.
- Effort: Small-Med · Risk: Low. Best paired with the batch-signing change ([[393-pending-p2-batch-signed-url-fan-out]]).

### Option B — Add a small outbound-signing semaphore / circuit breaker (for 2)
- Cap global concurrent sign calls (or trip a breaker on sustained failures) so a spike can't open
  thousands of Supabase sockets. Largely obviated once batch signing + memoization land.
- Effort: Medium · Risk: Low-Med.

### Option C — Accept as-is
- Only bites during an upstream degradation; fail-open already prevents user-facing 500s.

## Recommended Action
_(triage)_ — Do 1 & 3 (Option A) alongside #393; treat 2 (Option B) as optional, likely unnecessary
after batch signing + the deferred Redis memo.

## Technical Details
- Affected: `storage-service.interface.ts` (AbortSignal), `supabase-storage.service.ts`,
  `artworks.service.ts`.

## Acceptance Criteria
- [ ] A timed-out sign aborts the underlying request (no lingering socket).
- [ ] Fail-open warn includes the artwork id.
- [ ] (Optional) global signing concurrency is bounded.

## Resolution (2026-08-24, complete)
1. **Timeout abandons in-flight request (abort).** Supabase `createSignedUrls` exposes **no `AbortSignal`**
   (options are only `download`/`cacheNonce`), so a true fetch-abort is not threadable through the SDK.
   The batch change in [[393-complete-p2-batch-signed-url-fan-out]] is the substantive mitigation: a
   detail read now holds **1** outbound socket instead of up to 21, so a slow-Supabase period accumulates
   at most one abandoned request per in-flight detail read (not 21). True per-request abort is deferred
   pending an SDK/fetch-level hook.
2. **Aggregate backpressure / circuit breaker.** No longer warranted: after batching, each detail read
   makes a single outbound sign call, so the 21× amplification that motivated a global cap is gone. The
   per-IP 20/min throttle now bounds outbound sign volume 1:1. Deferred as unnecessary; revisit only if a
   future change reintroduces multi-call fan-out.
3. **Fail-open logs lack asset context.** DONE: `signBatch` now takes the artwork id and logs it on both
   the timeout and the failure path (`…for artwork <id>; omitting N asset(s)`), so a "missing image"
   report is traceable without leaking internal bucket keys.

Verified: build 0, lint clean, artworks unit 19/19.

### Files changed
- `src/modules/artworks/artworks.service.ts` (artwork-id logging; abort/backpressure resolved via #393).

## Work Log
- 2026-08-24: Filed from PR #50 review (performance-oracle P3, security-sentinel P3, kieran-ts P3).
- 2026-08-24: Resolved — asset-id logging added; abort not SDK-supported but socket concern collapsed by #393's batching; backpressure unnecessary post-batch. Complete.
