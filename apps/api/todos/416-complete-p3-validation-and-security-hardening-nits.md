---
status: complete
priority: p3
issue_id: 416
tags: [code-review, tov-30, pr-53, security, validation, quality]
dependencies: []
---
# Validation & security-hardening nits (invisible-char allowlist, website URL, storage error mapping, top-level body guard)

## Resolution (2026-08-26)
1. `hasControlChars` now iterates CODE POINTS (for…of) and rejects U+00AD, U+061C, U+2028/2029, U+2060–2064, and the U+E0000–E007F tag block in addition to the prior set (bio/statement + social URLs). Unit test covers zero-width/bidi/tag samples.
2. `website` — added a SECURITY comment: never fetched server-side; if it ever is, route through an egress allowlist (SSRF), and the FE renders hrefs with `rel="noopener noreferrer nofollow ugc"` (already in the FE contract).
3. `downloadSource` — now that the `objectSize` gate (#411) confirms existence first, a download failure is transient → 503 `PROFILE_STORAGE_UNAVAILABLE` (new code) instead of masking a storage outage as 422 `PROFILE_UPLOAD_MISSING`.
4. `validateAndBuildPatch` — added a top-level `isPlainObject(body)` guard → self-contained 422 (`field:'body'`) instead of relying on the body-parser to reject non-object bodies.
Build + lint + profile unit (26) green.

## Problem Statement
A cluster of low-severity validation/security hardening opportunities surfaced across the PR #53 (TOV-30) profile-fields review. None are live-exploitable today (the framework escapes output, no server-side fetch of user URLs exists, Nest's body-parser rejects primitive bodies), but each closes a latent spoofing, phishing/SSRF, observability, or robustness gap on fields designed for **public** display.

## Findings
1. **`hasControlChars` allowlist is incomplete.** `src/modules/users/profile/profile-validation.ts:27-42` — the invisible/control-char rejection set misses U+2028/U+2029 (line/paragraph separator, which fall in the gap between 0x200F and 0x202A), U+061C (Arabic letter mark), U+2060–U+2064 (word joiner / invisible operators), U+00AD (soft hyphen), and the U+E0000–U+E007F tag block. These fields render on the **public** profile, so bidi/invisible spoofing is the real risk (not XSS — the framework escapes). Add the missing ranges, or invert to a Unicode-category allowlist.
2. **`website` social link accepts ANY https URL.** `src/modules/users/profile/constants/social-links.constant.ts:23` (`/^https:\/\/\S+$/i`) consumed at `profile-validation.ts:96-106` — an open-redirect/phishing vector on the public profile and a latent SSRF landmine if any future feature ever fetches it server-side. No live SSRF today (display-only). Fix: document "never fetch server-side" + have FE render `rel="noopener nofollow ugc"`, and optionally reject private/link-local hosts. (Note: the twitter/instagram host regexes ARE tight — the required trailing `/` after the host defeats the `x.com@evil.com` / `x.com.evil.com` tricks; no bypass there.)
3. **`downloadSource` maps EVERY storage error to 422 `PROFILE_UPLOAD_MISSING`.** `src/modules/users/profile/profile.service.ts:228-234` — a transient Supabase 5xx/timeout is reported as a client fault and erases the real failure from observability. Fix: distinguish object-not-found (→ 422) from transport/5xx (→ 503 retryable).
4. **`validateAndBuildPatch` lacks a top-level object guard.** `src/modules/users/profile/profile-validation.ts:149` (reached from `me-profile.controller.ts:38`) — `'bio' in body` throws a `TypeError` on a primitive body → 500. Currently NOT reachable (Nest's body-parser rejects top-level primitives with 400), but the 422 contract rests on an external default. Cheap hardening: `if (!isPlainObject(body)) return { patch: {}, errors: [{ field: 'body', message: 'body must be an object' }] }` (`isPlainObject` already exists).

## Proposed Solutions
### Option A — Apply the cheap wins, document the URL policy (Recommended)
Apply 1 (extend/invert the char allowlist), 3 (split not-found vs transport errors), and 4 (top-level object guard). For 2, document the never-fetch-server-side contract and the FE `rel` attributes; optionally add a private/link-local host reject.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/modules/users/profile/profile-validation.ts`, `src/modules/users/profile/constants/social-links.constant.ts`, `src/modules/users/profile/profile.service.ts`, `src/modules/users/profile/me-profile.controller.ts`.

## Acceptance Criteria
- [ ] Each nit is either applied or consciously declined with a reason.

## Work Log
- 2026-08-26: Filed from PR #53 review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/53
