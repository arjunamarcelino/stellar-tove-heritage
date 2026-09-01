---
status: complete
priority: p3
issue_id: 376
tags: [code-review, security, privacy, tov-175, pr-48]
dependencies: []
---
# `QuoteResponseDto` exposes the raw seller `holderSub` — a pseudonymity trap if reused cross-actor (PR #48)

## Problem Statement
The quote response DTO exposes a holder's internal JWT `sub`. On this POST the response goes only to the
submitter, so it is self-data and safe today. But the codebase deliberately never exposes an internal `sub`
across actors (the notifications/collectors paths "never expose the buyer's `collector_sub`"). If
`QuoteResponseDto.fromEntity` is reused for the FR-06.04 accept-and-settle read — where the RFQ creator sees
holders' quotes — it becomes a cross-actor identity leak.

## Findings
Source: security-sentinel (P3-1).
- `src/modules/marketplace/quotes/dto/quote-response.dto.ts:14` — `holderSub!: string`, emitted at
  `quotes.service.ts:180` and `:187`.
- Safe now (self-only response); risk is future reuse on a cross-actor read.

## Proposed Solutions
### Option A — Document the self-only constraint + do not reuse verbatim (Recommended)
- Add a note on `QuoteResponseDto` that `holderSub` is self-only; any cross-actor quote read (FR-06.04) MUST
  project to a pseudonymous handle or omit the field (a separate response DTO).
- Pros: zero behavior change now; guards the future path. Cons: relies on the next author reading the note.
- Effort: Small · Risk: None
### Option B — Drop `holderSub` from the response now
- The submitter already knows their own identity, so the field arguably adds nothing.
- Pros: removes the leak surface entirely. Cons: FE may expect it; minor contract change (update the FE API
  contract doc).
- Effort: Small · Risk: Low

## Recommended Action
Option A now; revisit Option B when FR-06.04's quote-list read is designed (use a distinct pseudonymous DTO there).

## Resolution (2026-08-22, complete — Option B, dropped)
Removed `holderSub` from `QuoteResponseDto` (field + `fromEntity` assignment) — the submitter already knows their
own id, so the field added nothing and its removal eliminates the leak surface + reuse trap entirely. Added a DTO
note that any FR-06.04 cross-actor quote read must project a pseudonymous handle, not this DTO. Updated the FE
API-contract doc (dropped the `holderSub` line) and the tests (unit asserts the response has NO `holderSub`;
e2e interface trimmed). Build 0; quote unit 26 / e2e 16 green.

## Technical Details
- Affected: `quote-response.dto.ts` (doc/field), FE API contract if dropped.

## Acceptance Criteria
- [x] `holderSub` removed from the response (Option B).
- [x] DTO note added: FR-06.04's cross-actor read must use a pseudonymous DTO, not this one.

## Work Log
- 2026-08-22: Filed from PR #48 review (security-sentinel P3-1).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
