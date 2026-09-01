---
status: complete
priority: p2
issue_id: 393
tags: [code-review, tov-189, pr-50, performance, storage, scalability]
dependencies: []
---
# Detail read fans out to up to 21 individual Supabase sign calls; a batch API exists

## Problem Statement
`GET /api/v1/artworks/:id` signs each supporting-image path + the COA path with a **separate**
Supabase `createSignedUrl` HTTP round-trip. A fully-populated detail (20 images + COA) issues up to
**21 concurrent outbound requests to the Supabase Storage API for one page load**, on the most-exposed
anonymous endpoint. The fail-open masks the cost (images silently drop under load rather than erroring),
so it surfaces in production as "images intermittently missing," not an obvious failure.

## Findings
- `src/modules/artworks/artworks.service.ts:67-68` (`signAll` maps each path to `safeSign`) and
  `:79-82` (`safeSign` → `storage.createTemporaryUrl` → one POST per path).
- `src/modules/storage/supabase-storage.service.ts:65-76` — `createTemporaryUrl` calls
  `supabase.storage.from(bucket).createSignedUrl(path, ttl)` (single-path).
- The installed `@supabase/storage-js` exposes **`createSignedUrls(paths[], expiresIn)`** — one POST
  that signs the whole batch (`node_modules/@supabase/storage-js/.../StorageFileApi.ts`). The
  `IStorageService` port (`storage-service.interface.ts:3`) only models the single-path variant, so the
  batch capability is currently unreachable.
- **Failure scenario:** a burst of concurrent detail reads (anonymous; throttle is only 20/min *per IP*,
  unbounded IPs) multiplies external API pressure ~21× and can trip Supabase's per-project signing rate
  limit; rate-limited/slow signs then hit the 800ms fail-open path and images drop from responses —
  degrading precisely under load, one TLS handshake per path instead of one per request.

## Proposed Solutions
### Option A — Add a batch `createTemporaryUrls` to the port + Supabase adapter (Recommended)
- Extend `IStorageService` with `createTemporaryUrls(paths: string[], expiresIn): Promise<(string|null)[]>`
  backed by `createSignedUrls`; have the service sign supporting images (and optionally COA) in one call,
  preserving per-asset fail-open (map a missing/errored entry → omitted/null). Keep the per-call timeout
  at the batch granularity.
- Effort: Medium · Risk: Low (additive port method; existing single-path callers untouched).

### Option B — Redis-memoize signed URLs by `storage_path` (TTL ≪ 3600s)
- Cache signed URLs cross-request so repeated views of a popular artwork don't re-sign. Complements A;
  bigger win under read-heavy load but adds a cache dependency. (Deferred lever already noted in the plan.)
- Effort: Medium · Risk: Low-Med.

### Option C — Accept as-is
- `take:20` + 800ms timeout + 20/min throttle bound a single request; only the aggregate external
  volume is unbounded. Acceptable until browse traffic grows.

## Recommended Action
_(triage)_ — Option A is the clean, proportionate fix and removes the dominant scalability cost of the
feature. Consider B only if browse latency/load later demands it.

## Technical Details
- Affected: `src/modules/storage/storage-service.interface.ts`, `supabase-storage.service.ts`,
  `src/modules/artworks/artworks.service.ts` (+ `test/shared/fake-storage.ts` for the batch method).

## Acceptance Criteria
- [ ] A detail read with N supporting images issues **one** Supabase sign call (not N), COA optionally folded in.
- [ ] Per-asset fail-open preserved (a bad path → omitted image / null COA, still 200).
- [ ] Existing single-path callers (files domain) unchanged.

## Resolution (2026-08-24, complete) — Option A
- Added `createTemporaryUrls(paths[], expiresIn): Promise<(string|null)[]>` to `IStorageService`
  (`storage-service.interface.ts`), backed by Supabase `createSignedUrls` in `SupabaseStorageService`
  (one POST for the whole batch; **fail-open per item** — a whole-batch error or a per-item error yields
  `null` at that position, never throws; result aligned to input order).
- Rewrote the service signing to a single batched call: `signAssets` builds one `paths` array
  (`[...supportingImages, coa?]`), calls `signBatch` (one round-trip, bounded by the existing 800ms
  timeout → all-null on timeout/failure), then splits results back into `supportingImages` (nulls
  omitted) + `coaSignedUrl` (null-safe). A detail read now issues **1** Supabase sign call instead of up
  to 21. Primary image stays passthrough; per-asset fail-open preserved.
- `test/shared/fake-storage.ts` gained `createTemporaryUrls` (per-path `failFor` → null). Unit signing
  tests rewritten around the batch API (one-call assertion, per-item null fail-open, whole-batch reject,
  timeout). Single-path `createTemporaryUrl` kept for the files domain (unchanged).

**SDK note (affects [[395-pending-p3-signing-resilience-and-observability]]):** `createSignedUrls` exposes
no `AbortSignal` (options are only `download`/`cacheNonce`), so a true fetch-abort isn't threadable — but
batching collapses the abandoned-socket concern from up to 21 sockets to **1**, which is the substantive
mitigation.

Verified: build 0, lint clean, artworks unit 19/19, full unit 1019, e2e 7/7.

### Files changed
- `src/modules/storage/storage-service.interface.ts`, `src/modules/storage/supabase-storage.service.ts`
- `src/modules/artworks/artworks.service.ts`
- `test/shared/fake-storage.ts`, `test/unit/modules/artworks/artworks.service.spec.ts`

## Work Log
- 2026-08-24: Filed from PR #50 review (performance-oracle P2).
- 2026-08-24: Resolved — batch `createTemporaryUrls` port + adapter + service rewrite (21→1 sign call). Complete.
