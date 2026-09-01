---
status: complete
priority: p2
issue_id: 187
tags: [code-review, performance, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — both halves
**1. Memory / concurrency gate:** `KycConcurrencyInterceptor` (a shared in-process counter, no new dep)
applied BEFORE the Multer file interceptor on `POST /me/kyc/submissions`, so over-capacity requests get
**503** *before* the ~40MB body is buffered. Cap = `KYC_MAX_CONCURRENT_SUBMISSIONS` (config, default 4).

**2. Event-loop blocking:** instead of the worker pool (which would duplicate the security-critical envelope
crypto + add TS-worker/vitest fragility), the crypto is now **cooperatively chunked** (decision: chunked over
worker pool). `encryptDocument` / `decryptDocument` / `hashPlaintext` process the buffer in 64KB slices and
`await setImmediate` between chunks (`kyc-crypto.service.ts`), so a large submission no longer monopolizes the
event loop — other requests/health-probes are serviced between chunks. All crypto stays single-sourced in
`KycCryptoService` (no duplication), works identically in dev/prod/test. `hashPlaintext` is now `async`
(the service awaits it). Tradeoff: no true multi-core parallelism (still one CPU thread), but the long
non-yielding block is gone and the gate bounds concurrent load.

Unit (36, incl. the 10MB round-trip that exercises chunking + gate cap→503/release) + KYC e2e (9) + build +
lint green.

# KYC submit: synchronous crypto blocks the event loop + no aggregate concurrency gate (OOM cliff)

## Problem Statement
The KYC submit path does all CPU-bound crypto **synchronously on the main libuv event loop** and buffers
~40MB per request **with no server-wide concurrency limit**. Per-user `@Throttle(5/hr)` keys on the JWT
`sub`, so N distinct users multiply both effects linearly. This is a real production scale/availability
risk (reviewer rated both P1-scalability); functionally correct, so P2 for merge but P1-severity for
prod scale.

## Findings
- Synchronous crypto (no worker offload, no streaming):
  - `src/modules/kyc/crypto/kyc-crypto.service.ts:61` — `Buffer.concat([cipher.update(plaintext), cipher.final()])` over a full ~10MB buffer.
  - `src/modules/kyc/crypto/kyc-crypto.service.ts:91` — `createHmac('sha256').update(plaintext).digest()` full-buffer.
  - `encryptDocument` is `async` but contains no real async work (`wrapDek` returns `Promise.resolve`), so all CPU runs on the calling tick. Worst case ≈ 80MB hashing + 40MB AES synchronously ⇒ ~100–250ms of non-yielding event-loop block per request; every other request/health-probe stalls. Liveness probe can miss its deadline and restart the pod mid-submit.
- No aggregate concurrency gate:
  - `src/modules/kyc/kyc.controller.ts:35` — throttle is per-identity (does NOT bound aggregate memory).
  - `src/modules/kyc/kyc.controller.ts:46` — Multer `memoryStorage`, `files:4, fileSize:10MB` ⇒ ~40MB plaintext buffered per request; during encryption +~20–30MB transient (`Buffer.concat` at `kyc-crypto.service.ts:61`). Realistic peak ~50–70MB/request. ~30–50 concurrent submits exhausts a 2–4GB container ⇒ V8 OOM / OOMKill. Reachable by 50 real users (or 50 accounts each within 5/hr).

## Proposed Solutions
### Option A (recommended): worker pool + bounded queue (the pool IS the concurrency gate)
- Move `encryptDocument` + `hashPlaintext` to a `worker_threads`/`piscina` pool sized to `availableParallelism()-1`; transfer buffers via `transferList`. Add a bounded queue depth → excess requests fail fast `503 Retry-After`.
- **Pros:** frees the main loop AND caps simultaneous heavy work/memory in one mechanism. **Cons:** new dependency + worker plumbing. **Effort: Large.**

### Option B: streaming (Multer diskStorage / stream-to-Supabase) + Node stream cipher/hmac
- Bounds heap regardless of concurrency and yields the loop between chunks. **Cons:** reworks the magic-number sniff (needs head bytes) and the `upload(buffer)` signature. **Effort: Large.**

### Option C: interim in-process semaphore only
- `p-limit`/semaphore around the heavy section (2–4×CPU) returning 503 when saturated — closes the OOM cliff without offloading CPU. **Pros:** small. **Cons:** doesn't fix event-loop blocking. **Effort: Small.** Good stopgap paired with A later.

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/kyc/crypto/kyc-crypto.service.ts`, `src/modules/kyc/kyc.controller.ts`, `src/modules/kyc/kyc.service.ts` (encrypt/upload loop lines 119–136).
- This is the previously-deferred perf-C1/perf-C2 from the plan, now confirmed against the shipped code.

## Acceptance Criteria
- [x] Encryption + hashing no longer block the main event loop for the full buffer. ✅ (cooperative 64KB chunking + `setImmediate` yield)
- [x] A bounded aggregate concurrency limit exists on the submit path; saturation returns a clean 503, not OOM. ✅ (`KycConcurrencyInterceptor`, cap before Multer buffers)
- [ ] _(follow-up, optional)_ Formal load test: K concurrent 40MB submits vs container memory budget + p99 of unrelated endpoints. Not blocking; behavior is covered by unit/e2e.

## Work Log
- 2026-07-17: Filed from PR #30 review (performance-oracle + security-sentinel P3-4). No code changed.
