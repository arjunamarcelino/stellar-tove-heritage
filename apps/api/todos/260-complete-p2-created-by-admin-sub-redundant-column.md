---
status: complete
priority: p2
issue_id: 260
tags: [code-review, simplicity, schema, TOV-152, PR-36]
dependencies: []
---

# `created_by_admin_sub` column is write-only and duplicates the audit log

## Problem Statement
`offerings.created_by_admin_sub` is written on insert but never read back (absent from `OfferingResponseDto` and every query). "Who planned this offering" is already durably recorded by the `offering.planned` audit row written in the same transaction (`actorId: adminSub`, `subjectId: offering.id`). The column both duplicates available data and has no precedent among sibling entities.

## Findings
Flagged by **code-simplicity-reviewer (P2)**. Note the tension: the deepen-plan phase deliberately KEPT this column ("on-row provenance for a longer-lived money object + maker/checker traceability"), so this is a triage decision, not a clear defect.
- `src/modules/offerings/entities/offering.entity.ts` — `createdByAdminSub` field; `1716000000032-CreateOfferingsTable.ts` — `created_by_admin_sub` column; written at `backoffice-offerings.service.ts` insert.
- `grep created_by/createdBy across *.entity.ts` → zero other hits; the direct sibling `fraction_contracts` records the actor only via `AuditLogService`, not an on-row column.
- Counter-argument (from the plan): the audit log is append-only and could be pruned/retained separately; an on-row creator supports a future admin "offerings by planner" query without a join to the audit table.

## Proposed Solutions
1. **Drop** the column + entity field + migration column; rely on the audit row (matches `fraction_contracts` and the codebase convention). Add it back when a read actually needs it (YAGNI). Effort: Small.
2. **Keep + justify** — add a one-line entity comment stating it's intentional denormalized provenance for later admin reads / maker-checker, so it's not later flagged as an orphan. Effort: trivial.

## Recommended Action
**RESOLVED — Solution 2 (keep + justify), user confirmed.** The column is kept (honoring the plan's
deliberate decision) with justification comments added to `offering.entity.ts` (`createdByAdminSub` JSDoc)
and the migration 032 header: deliberate denormalization for a future admin "offerings by planner" read
without joining the separately-retained audit log; intentionally no FK to `admins` (audit-actor semantics).

## Technical Details
- `src/modules/offerings/entities/offering.entity.ts`, `src/database/migrations/1716000000032-CreateOfferingsTable.ts`, `src/modules/backoffice/offerings/backoffice-offerings.service.ts`.
- If dropped pre-merge, no data migration needed (table is new/unshipped).

## Acceptance Criteria
- [x] Decision recorded: keep-with-justification (user confirmed).
- [x] Entity + migration comments document the deliberate denormalization and the intentional no-FK.

## Work Log
- 2026-08-18: created from PR #36 review (code-simplicity-reviewer P2). Cross-ref: deepen-plan kept it deliberately.
- 2026-08-18: RESOLVED — kept; added justification comments to `offering.entity.ts` + migration 032 header. Build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
