---
status: complete
priority: p3
issue_id: 243
tags: [code-review, security, data-exposure, follow-up, TOV-240, PR-34]
dependencies: []
---

# Security follow-ups: confirm `artistUserId` exposure; validate `primaryImageUrl` at the write path

## Problem Statement
Two low-severity, confirm-or-defer items from the security review. Neither is a defect in this read-only PR; both are follow-ups.

## Findings
Flagged by security-sentinel (P3 x2).
1. **`artistUserId` in the detail DTO.** `artwork-detail.dto.ts:26` exposes the internal user UUID to the ADMIN/SUPERADMIN detail view (not in the list DTO). Acceptable for an admin audience that legitimately resolves the artist — but confirm it's intended; if the frontend only renders `artistName`/`artistHandle`, the raw UUID could be dropped. No secret columns (`artist_address`, etc.) are exposed — DTOs are explicit allow-lists, not entity spreads.
2. **`primaryImageUrl` is a raw stored URL echoed verbatim.** `artwork-detail.dto.ts:34`, `artwork-list-item.dto.ts:20`. **No SSRF** on this surface — the backend only returns the string, never fetches it. Residual risk is stored-XSS / open-redirect *if a client renders it unsanitized*, which is an ingest-time concern: is `primary_image_url` constrained to a trusted storage host/scheme at the write path (TOV-233 ingest)? Out of scope for this PR; track as a write-path follow-up.

## Proposed Solutions
1. Product/security confirm `artistUserId` belongs in the admin detail response; drop it if unused. Effort: Trivial.
2. Add scheme/host allow-list validation for `primary_image_url` at the TOV-233 write/ingest path (separate ticket). Effort: Small–Medium, not here.

## Recommended Action
**RESOLVED.**
1. **`artistUserId` kept** (user-confirmed) — admins legitimately resolve the artist by id; admin-only surface, not on the list row. Documented as intentional with an inline comment on `ArtworkDetailDto.artistUserId`.
2. **`primaryImageUrl` write-path validation** is out of scope for this read-only PR — it belongs to the TOV-233 ingest/write path. Tracked here as a **separate follow-up ticket** to add scheme/host allow-list validation at write time (no change to these read endpoints). No SSRF on this surface (the backend only returns the string, never fetches it).

## Technical Details
- #1 is a one-field DTO decision on this PR. #2 is a separate write-path ticket (TOV-233 ingest), not a change to these read endpoints.

## Acceptance Criteria
- [ ] `artistUserId` exposure confirmed intended (or removed).
- [ ] Write-path `primary_image_url` host/scheme validation tracked as its own ticket.

## Work Log
- 2026-07-18: created from PR #34 review (security-sentinel).
- 2026-07-18: RESOLVED — artistUserId kept + documented as intentional; primaryImageUrl deferred to a TOV-233 write-path follow-up ticket. Build + lint clean.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
