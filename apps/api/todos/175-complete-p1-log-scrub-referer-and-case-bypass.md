---
status: complete
priority: p1
issue_id: 175
tags: [code-review, security, logging, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A (surgical). (1) Added `'req.headers.referer'` and `'req.headers.referrer'` to the pino
`redact.paths` in `src/app.module.ts` so the whole Referer header is censored — a browser that renders
`/collectors/<handle>` or calls `/handles/check?handle=X` no longer re-leaks the handle via the Referer on
the next request. (2) Made `redactUrlQueryParams` case-INSENSITIVE on the key (regex `gi` flag) so
`?Handle=`/`?HANDLE=` variants are redacted while the original key casing is preserved; updated the util
docstring accordingly. Flipped the unit test that previously asserted `?Handle=` passed through to assert it
is now redacted (both `Handle`/`HANDLE`); the substring-safety test (`myhandle`/`handled`) still passes since
the match is anchored on `^|&`. Did NOT need `req.query` redaction — pino's request serializer emits only
`req.url` (which the scrub rewrites) and `req.headers` (now referer-redacted), not a parsed `req.query`.
Build clean; redact unit suite (9) green.

# Log-scrub is bypassed by the Referer header and case-variant query keys

## Problem Statement
The TOV-27 access-log scrub (`redactUrlQueryParams` wired via the pino request serializer) only rewrites
`req.url`. Two gaps let the handle re-enter access logs in plaintext, defeating the scrub's purpose:
(1) the `Referer`/`Referrer` header still carries the full URL including the handle and is NOT in
`redact.paths` (only authorization/cookie/set-cookie are). A browser that renders `/collectors/<handle>`
or calls `/handles/check?handle=X` sends `Referer` on the NEXT request, which is logged verbatim.
(2) `redactUrlQueryParams` is case-sensitive (unit test asserts `?Handle=maya` passes through), so
`?Handle=`/`?HANDLE=` bypass redaction.

## Findings
- `src/app.module.ts:68-87` — `redact.paths` lacks `referer`/`referrer`; the serializer only rewrites `req.url`.
- `src/common/logging/redact-query.util.ts:19` — regex is case-sensitive.
- `test/unit/common/logging/redact-query.util.spec.ts:31` — asserts `?Handle=` is NOT redacted.

## Proposed Solutions
### Option A: Surgical
- Add `'req.headers.referer'` and `'req.headers.referrer'` to `redact.paths` (censor whole header); make
  the regex case-insensitive (add `i` flag or lowercase-compare the captured key); defensively redact
  `req.query.handle` if `req.query` is ever serialized.
- **Pros:** complete; preserves other query params in logs. **Cons:** none material. **Effort: Small.**

### Option B: Broad
- Strip the entire query string from logged URLs AND redact `referer` entirely.
- **Pros:** simplest to reason about. **Cons:** loses all query params from logs. **Effort: Small.**

## Recommended Action
_(triage — Option A: surgical and complete.)_

## Technical Details
- Files: `src/app.module.ts`, `src/common/logging/redact-query.util.ts`, `test/unit/common/logging/redact-query.util.spec.ts`.

## Acceptance Criteria
- [x] `referer`/`referrer` headers are redacted in access logs.
- [x] `?Handle=`/`?HANDLE=` variants are redacted (regex case-insensitive); unit test updated to assert this.
- [x] No handle value appears in ANY log field for a `/handles/check` or `/collectors/:handle` request (url scrubbed + referer redacted; serializer emits no `req.query`).

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (security-sentinel).
- 2026-07-15: Resolved (Option A) — referer/referrer in redact.paths + case-insensitive key match + unit test flipped. Build + redact unit green.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
