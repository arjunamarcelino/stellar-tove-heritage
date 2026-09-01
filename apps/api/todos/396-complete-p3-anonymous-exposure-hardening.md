---
status: complete
priority: p3
issue_id: 396
tags: [code-review, tov-189, pr-50, security, deployment]
dependencies: []
---
# Anonymous exposure hardening: COA TTL, proxy-hop sensitivity, error caching

## Problem Statement
Defense-in-depth items for an anonymous, storage-signing read endpoint. No exploitable defect — the
core non-oracle 404, no-path-leak, and no-internal-id-leak properties are all verified correct. These are
posture/documentation items.

## Findings
1. **1h signed COA/image URLs are anonymous, long-lived, body-visible capabilities.**
   `artworks.service.ts:80` (TTL = `filesConfig.signedUrlTtl`, default 3600s). `Cache-Control: no-store`
   correctly blocks shared HTTP caches, but not APM/proxy body logging, browser history, or `Referer`
   propagation — any turns the token into a 1h shareable capability to a private-bucket object (the COA
   is signed *because* the bucket is private). Consider a shorter TTL specifically for the anonymous COA,
   or explicitly accept/document the exposure. (security)
2. **DoS posture rests on `TRUST_PROXY_HOPS`.** `artworks.controller.ts:29` (anonymous → IP-keyed
   throttle) + `main.ts` / `app.config.ts`. Hops too low / shared NAT → callers collapse into one bucket
   and the low 20/min limit self-DoSes the public surface; hops too high → spoofed `X-Forwarded-For`
   mints unlimited buckets and defeats the amplification cap. Inherited infra config, but this endpoint's
   uniquely low limit + 21× amplification make it the most sensitive consumer — call it out in the deploy
   runbook. (security/ops)
3. **`no-store` not guaranteed on error responses.** `artworks.controller.ts:27` — the header is applied
   on the handler return path; a thrown `NotFoundException`/500 is written by `AllExceptionsFilter` and
   may not carry it. Low impact (404/500 bodies contain no capability URL) — informational. (security)

## Proposed Solutions
### Option A — Document in the deploy runbook + decide the COA TTL (Recommended)
- Add a TOV-189 note to the deploy runbook: verify `TRUST_PROXY_HOPS` for the real topology; the detail
  route is amplification-sensitive. Decide whether the anonymous COA warrants a TTL shorter than the
  shared 3600s default (e.g. a dedicated shorter value) or is accepted as public.
- Effort: Small · Risk: none.

### Option B — Also enforce no-store on error responses
- Have `AllExceptionsFilter` (or a route-level guard) stamp `no-store` on this route's error responses.
  Marginal value; only if the header guarantee matters.
- Effort: Small · Risk: Low.

## Recommended Action
_(triage)_ — Option A. Product already confirmed COA is public-safe; the decision here is TTL length +
runbook documentation, not gating.

## Technical Details
- Affected: deploy runbook (new/existing), optionally `files.config.ts` (a dedicated COA TTL), the
  exception filter (only for B).

## Acceptance Criteria
- [ ] Deploy runbook notes the `TRUST_PROXY_HOPS` sensitivity + amplification for this route.
- [ ] Anonymous COA TTL is a conscious decision (shortened or explicitly accepted at 1h).

## Resolution (2026-08-24, complete) — Option A (document; keep 1h TTL)
Decision (confirmed with product/security): **keep the shared 1h `FILES_SIGNED_URL_TTL`** — COA is
public-safe for verified/fractionalized artworks and `no-store` keeps signed URLs out of shared caches.
Documented in a new deploy note `docs/solutions/deployment-issues/2026-08-24-tov189-artwork-detail-deploy-note.md`:
1. **COA/image TTL** — accepted at 1h; note records how to gate/shorten if an artwork is ever deemed sensitive.
2. **`TRUST_PROXY_HOPS`** — called out as this route's most sensitive infra setting (its low 20/min per-IP
   limit self-DoSes if hops are too low; spoofable if too high) + a pre-deploy checklist item. Also notes
   the signing amplification is now 1:1 after the #393 batch change (no global cap needed).
3. **`no-store` on error responses** — documented as informational/nil-impact (404/500 bodies carry no
   capability URL); no code change.

No code change — this is a posture/documentation item. The core non-oracle 404, no-path-leak, and
no-internal-id-leak properties were verified correct by the review.

### Files changed
- `docs/solutions/deployment-issues/2026-08-24-tov189-artwork-detail-deploy-note.md` (new)

## Work Log
- 2026-08-24: Filed from PR #50 review (security-sentinel P3, three grouped items).
- 2026-08-24: Resolved — deploy note added (TTL accepted at 1h, proxy-hops + amplification documented). Complete.
