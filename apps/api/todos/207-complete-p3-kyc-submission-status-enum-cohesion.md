---
status: complete
priority: p3
issue_id: 207
tags: [code-review, architecture, kyc, TOV-29, PR-31]
dependencies: []
---

# `KycSubmissionStatus` co-located in `common/enums` — mild cohesion smell (optional split)

## Problem Statement
The dependency-inversion fix (TOV-29 R1) only required the user-level `KycStatus` to move to
`common/enums` (so the neutral `users` entity imports it *down*). The PR moved the whole file, so
`KycSubmissionStatus` — a kyc-domain-private concept imported **only** by the kyc module — now also lives
in shared `common/`. A reader of `common/enums` can't tell that one enum is platform-shared and the other
is a kyc-internal detail.

This is **acceptable inherited-precedent territory, not a violation**: `src/common/CLAUDE.md` instructs
"Add new enums to `src/common/enums/`," and existing entries there (`submission-status`,
`verification-method`, `evidence-type`) are each single-domain too — so `common/enums` is already a flat
enum bag, not a strictly-shared-only namespace. Filed as an optional cohesion refinement.

## Findings
- `src/common/enums/kyc-status.enum.ts:28` — `KycSubmissionStatus` now in common. Grep confirms zero non-kyc consumers (`kyc.service.ts`, `kyc-submission.entity.ts`, `dto/kyc-status-response.dto.ts`, `dto/kyc-submission-response.dto.ts`). (architecture-strategist P3.)

## Proposed Solutions
### Option A: leave as-is (recommended)
Treat the flat `common/enums` convention as intentional; the two enums are documented as two axes of one
concept in the file's doc-comment. **Effort: none.**

### Option B: split for strict cohesion
Keep only `KycStatus` in `common/enums/kyc-status.enum.ts`; move `KycSubmissionStatus` to
`src/modules/kyc/enums/kyc-submission-status.enum.ts` and update the ~4 kyc importers. Architecturally
purer, small churn. **Effort: Small.**

## Recommended Action
**RESOLVED (Option B — split, per user decision).** Moved `KycSubmissionStatus` to a new
`src/modules/kyc/enums/kyc-submission-status.enum.ts`; `common/enums/kyc-status.enum.ts` now holds only the
neutral `KycStatus` (which the `users` entity depends on). Updated the 6 importers (kyc.service,
kyc-submission-response.dto, kyc-status-response.dto, kyc-submission.entity, and the two kyc specs) to the new
path. The `KycStatus` doc-comment now points at the new location for the submission-level axis.

## Technical Details
- Affected (if Option B): `src/common/enums/kyc-status.enum.ts`, a new `src/modules/kyc/enums/kyc-submission-status.enum.ts`, and 4 kyc importers.

## Acceptance Criteria
- [ ] A conscious decision is recorded: accept the flat `common/enums` convention, or split the submission-level enum back into the kyc module.

## Work Log
- 2026-07-17: Filed from PR #31 review (architecture-strategist P3). No code changed.
- 2026-07-17: RESOLVED (split). New `kyc/enums/kyc-submission-status.enum.ts`; 6 importers updated; grep confirms no `KycSubmissionStatus` import from common remains. build/lint/unit(426)/integration green. Status → complete.
