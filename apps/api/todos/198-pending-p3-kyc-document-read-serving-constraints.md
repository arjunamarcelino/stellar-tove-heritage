---
status: pending
priority: p3
issue_id: 198
tags: [code-review, security, kyc, TOV-28, future-ticket]
dependencies: []
---

# KYC read ticket constraint: magic-number sniff can't catch polyglots — pin attachment-only serving

## Problem Statement
The multipart validator's content check is a prefix-only magic-number sniff (correctly labeled "a
UX/early-reject control, not the security boundary"). A `%PDF-`-prefixed or image-magic-prefixed file can
carry active/polyglot content. In THIS PR the bytes are AES-GCM-encrypted at rest in a private bucket and
nothing renders them, so there is no live risk. The risk is entirely deferred to the future document-read
/ admin-review ticket — if that surface serves documents inline via signed URL and the browser
content-sniffs, it becomes stored-XSS-adjacent. Filing as a tracked constraint so the read ticket doesn't
miss it.

## Findings
- `src/modules/kyc/kyc-file.validator.ts:24-41` — prefix-only sniff (JPEG 3 bytes, PNG 8 bytes, PDF `%PDF-`); stored `content_type` is the sniffed value (good).
- No document-read HTTP surface exists in this PR (`createTemporaryUrl` unused here).

## Proposed Solutions
### Option A (recommended): constrain the read ticket
- When the read path lands: serve documents with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` (never inline), use a short dedicated `KYC_SIGNED_URL_TTL` (already in config), and re-authorize ownership (`submission.userId === caller.sub`) at URL-mint time. Never render KYC documents in the admin console inline. **Effort: n/a here (constraint for a later ticket).**

### Option B (optional now): stronger sniff at ingest
- Validate the PDF trailer / reject SVG at upload time. Low value since nothing renders yet. **Effort: Small.**

## Recommended Action
_(triage — carry into the document-read / admin-review ticket.)_

## Technical Details
- Affected (future): the not-yet-built KYC document read surface; `KYC_SIGNED_URL_TTL` in `src/config/kyc.config.ts` is already reserved for it.

## Acceptance Criteria
- [ ] The future read surface serves KYC documents as attachments with `nosniff`, short-TTL signed URLs, and ownership re-checks — never inline.

## Work Log
- 2026-07-17: Filed from PR #30 review (security-sentinel P2-2). No code changed.
