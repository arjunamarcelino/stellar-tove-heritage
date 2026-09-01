---
status: complete
priority: p2
issue_id: 400
tags: [code-review, tov-191, pr-51, data-integrity, migration, provenance]
dependencies: []
---
# Guard trigger does not block hard DELETE / TRUNCATE of provenance rows

## Resolution (2026-08-24) — Option A
Amended migration `1716000000047` (unreleased on `develop`): `fn_ate_guard` now rejects `TG_OP='DELETE'` **and** any change to `deleted_at` (soft-delete), and the trigger is `BEFORE UPDATE OR DELETE` — matching the secondary_trades / rfq_notifications convention. Column-level freeze on UPDATE unchanged; the `is_published` publish flip still works. Re-applied to the test DB (`yarn db:test:setup` after resetting the migration row). Added integration coverage asserting hard DELETE → "cannot be deleted", soft-delete → "cannot be soft-deleted", and the row survives both. Note: `TRUNCATE` does not fire row-level triggers, so test-cleanup truncation is unaffected. Confirmed `develop` has NOT run 047 yet, so amending in place is safe.
- Files: `src/database/migrations/1716000000047-CreateArtworkTimelineEvents.ts`, `test/integration/modules/timeline/timeline-emit.integration.spec.ts`.
- Verified: timeline-emit integration 6/6 pass.

## Problem Statement
`artwork_timeline_events` is explicitly framed as forward-only, no-backfill provenance where loss is unacceptable — its `down()` even refuses to drop the table outside dev/test for exactly this reason. But the guard trigger `trg_ate_guard` is declared `BEFORE UPDATE` only, and `fn_ate_guard` has no `TG_OP = 'DELETE'` branch. So a direct `DELETE FROM artwork_timeline_events ...` (or `TRUNCATE`) silently succeeds, permanently erasing provenance; the freeze-list only protects against *column mutation* on UPDATE. The `FK_ate_artwork ON DELETE RESTRICT` only blocks a cascade from `artworks` — it gives no protection against a direct delete on this table.

This diverges from **every** sibling append-only table in the repo, which fire `BEFORE UPDATE OR DELETE` and `RAISE` on `TG_OP = 'DELETE'` (also blocking soft-delete): confirmed in migrations `…041` (rfqs), `…042` (rfq_notifications), `…044` (rfq_quotes), `…045` (secondary_trades), `…038` (offering_clearing_audit), `…034`, `…017`. No application code currently deletes these rows, so this is a defense-in-depth / invariant-consistency gap rather than an active bug — but it contradicts the table's stated immutability guarantee and the codebase convention.

## Findings
- `src/database/migrations/1716000000047-CreateArtworkTimelineEvents.ts:83-103` — `fn_ate_guard` (no DELETE branch) + `CREATE TRIGGER trg_ate_guard BEFORE UPDATE` (not `BEFORE UPDATE OR DELETE`).
- Sibling precedent: `1716000000045-AddSecondaryTradesAndSellerAuth.ts:160-197` (block delete + soft-delete).

## Proposed Solutions
### Option A — Widen the trigger to `BEFORE UPDATE OR DELETE` + reject DELETE and soft-delete (Recommended)
Add `IF TG_OP = 'DELETE' THEN RAISE EXCEPTION ...` and a `NEW.deleted_at IS DISTINCT FROM OLD.deleted_at → RAISE` branch, matching the secondary_trades guard. Needs a new migration (the table is already applied in the test DB) OR — since this is unreleased on `develop` — an amendment to `047` before merge + re-run `yarn db:test:setup`.
- Pros: brings the table in line with every other provenance table; closes the silent-loss hole. Cons: decide whether soft-delete/retract of a timeline event is ever wanted (admin correction?) — if so, DELETE stays blocked but soft-delete stays allowed.
- Effort: Small · Risk: Low.

### Option B — Accept the gap, document it
Timeline is "best-effort/lossy" derived data (unlike money tables), so provenance loss via a manual DELETE may be an acceptable operational risk. Document that the immutability guarantee is column-level only.
- Pros: no change. Cons: contradicts the table's own framing + the `down()` prod-guard rationale; inconsistent with the repo.
- Effort: Small · Risk: Low (but leaves the invariant weaker than advertised).

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `1716000000047-CreateArtworkTimelineEvents.ts` (amend before merge, or a follow-up migration). Re-run `yarn db:test:setup` after.
- Integration test: `DELETE FROM artwork_timeline_events WHERE id=$1` → expect rejection.

## Acceptance Criteria
- [ ] Decision recorded: block hard delete (and soft-delete?) or accept lossy.
- [ ] If blocking: trigger widened to `BEFORE UPDATE OR DELETE` with a DELETE reject; integration test added.

## Work Log
- 2026-08-24: Filed from PR #51 review (data-integrity-guardian, P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
- Precedent: `src/database/migrations/1716000000045-AddSecondaryTradesAndSellerAuth.ts`
