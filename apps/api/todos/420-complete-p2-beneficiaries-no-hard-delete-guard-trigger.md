---
status: complete
priority: p2
issue_id: 420
tags: [code-review, tov-31, pr-54, data-integrity, database, compliance, simplicity]
dependencies: []
---
# `beneficiaries` has no DB guard enforcing the hard-delete-only invariant (soft-delete path stays reachable)

## Resolution (2026-08-26)
Option A. New migration `1716000000051-EnforceBeneficiariesHardDelete` adds a `BEFORE UPDATE` trigger
(`beneficiaries_no_soft_delete`) that RAISEs whenever an UPDATE sets `deleted_at` to non-NULL — blocking
any soft-delete while leaving hard `DELETE` and normal field updates untouched (BEFORE UPDATE doesn't fire
on DELETE; normal updates never touch `deleted_at`). Mirrors `internal_audit_log`'s append-only guard and
the marketplace `fn_*_guard` triggers, so the hard-delete-only invariant is now DB-enforced (defense-in-depth,
role-agnostic) rather than convention-only. Applied to `tove_test` via `db:test:setup`. Added integration
test `hard-delete-only guard: a soft-delete UPDATE is rejected by the trigger`. The redundant `DROP INDEX`
in migration 050's `down()` (item 2) was removed under #423. Build 0 issues; beneficiary integration 9/9 green.
Vestigial soft-delete apparatus (partial index / `IsNull()` scoping) left in place — it's now the substrate
the guard trigger protects, not dead code.

## Problem Statement
The `beneficiaries` domain invariant is **hard-delete only** — third-party PII must be physically purged and `deleted_at` must stay perpetually NULL. The shipped code honors this (`deleteByUserId` uses `repo.delete()`, a hard delete). But **nothing at the DB level enforces it**: `Beneficiary extends BaseEntity`, so the inherited `BaseRepository.softRemove()`/soft-delete path remains fully reachable. If any future code path (or a copy-paste of the common `softDelete()` pattern) soft-removes a row, third-party PII lingers silently in a `deleted_at IS NOT NULL` skeleton — violating the compliance goal — and the partial-unique index `WHERE deleted_at IS NULL` would simultaneously permit a **second active row** for that user. This diverges from the repo's own established hardening pattern: `rfq_notifications`, `secondary_trades`, `offering_bids`, and the KYC tables all carry a `BEFORE UPDATE/DELETE` guard trigger that blocks the transitions their domain forbids. `beneficiaries` — holding the most sensitive (third-party) PII — has none.

## Findings
1. **No guard trigger; soft-delete reachable.** `src/database/migrations/1716000000050-CreateBeneficiariesTable.ts` (no `fn_*_guard`), `src/modules/users/beneficiary/entities/beneficiary.entity.ts:9-12` (documents hard-delete-only, but only by convention). Flagged by **data-migration-expert (P3, "worth weighing for P2")** and code-simplicity (P3, "vestigial soft-delete apparatus").
2. **Vestigial soft-delete apparatus (simplicity P3).** Because removal is always hard, the `deleted_at` column, the *partial* predicate `WHERE deleted_at IS NULL` (a plain `UNIQUE(user_id)` would do), and the explicit `deletedAt: IsNull()` scoping in `applyUpdate` (`beneficiary.repository.ts:43`) are scaffolding worked around, not domain logic — a reader should know they're not enforcing anything.
3. **Tripwire.** `SELECT count(*) FROM beneficiaries WHERE deleted_at IS NOT NULL` must always be 0; a non-zero result means a soft-delete path leaked PII.

## Proposed Solutions
### Option A — Add a `BEFORE UPDATE` guard trigger rejecting any `deleted_at` set (Recommended)
Mirror `fn_rfq_notifications_guard`: a trigger that raises if a statement tries to set `deleted_at` to non-NULL (forcing hard-delete), making the invariant defense-in-depth. Effort: Small · Risk: Low. Requires a follow-up migration.
### Option B — Monitoring tripwire only
Add the `deleted_at IS NOT NULL` count to monitoring/alerting; accept convention-only enforcement in code. Effort: Small · Risk: relies on detection after the fact.
### Option C — Accept as-is
Current code is correct; document that soft-delete must never be used on this entity and rely on review. Effort: None · Risk: latent third-party-PII regression.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `src/database/migrations/` (new guard-trigger migration), `beneficiary.entity.ts`, `beneficiary.repository.ts`.
- Also cosmetic (P3): `1716000000050:56-57` `DROP INDEX` before `DROP TABLE` in `down()` is redundant (DROP TABLE drops owned indexes).

## Acceptance Criteria
- [ ] Either a DB guard blocks soft-delete on `beneficiaries`, or the tripwire query is monitored and the convention documented.

## Work Log
- 2026-08-26: Filed from PR #54 multi-agent code review (data-migration-expert + code-simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
- Pattern: `fn_rfq_notifications_guard`, `offering_bids` / `secondary_trades` guard triggers
