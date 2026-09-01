---
status: complete
priority: p3
issue_id: 394
tags: [code-review, tov-189, pr-50, data-integrity, migration]
dependencies: []
---
# artwork_images lifecycle gaps to close when the admin write/upload path lands

## Problem Statement
The `artwork_images` FK uses `ON DELETE CASCADE`, but the platform soft-deletes. All of the items below
are **latent/masked today** (no artwork delete path or image-upload path exists — images are seed-only,
and the detail read 404s on a soft-deleted parent before touching images), but each becomes a real bug
the moment an admin write/delete path ships. Grouped so the future write-path PR addresses them together.

## Findings
1. **Soft-deleting an artwork orphans its images.** `ON DELETE CASCADE` fires only on a hard `DELETE`
   (`1716000000046-…:47-48`, `artwork-image.entity.ts:47-48`). A soft-delete of the parent leaves every
   child row live (`deleted_at IS NULL`) and in the partial index. Any future reader of `artwork_images`
   that doesn't join `artworks.deleted_at` would surface images of a deleted artwork; the index
   accumulates permanent orphan entries. The `CASCADE` clause gives false confidence that deletes are
   handled. (data-integrity)
2. **FK doesn't reject inserts against a soft-deleted parent.** `1716000000046-…:47-48` — the FK
   validates row existence only, so an image can be inserted against a `deleted_at IS NOT NULL` artwork.
   The future upload path must reject this. (data-integrity)
3. **No uniqueness on `(artwork_id, sort_order)`.** Duplicate positions are allowed; the read tiebreaks
   on `id ASC` (`artwork-read.repository.ts:50`) so display order is deterministic — not a bug, but
   "position" is advisory. Relevant when the reorder path is designed. (data-integrity)
4. **Two-query detail read is non-atomic (document).** `artwork-read.repository.ts:42-52` reads artwork
   then images under read-committed with no wrapping txn (deliberate — avoids holding a pooled connection
   across the Supabase signing). A concurrent image insert/soft-delete yields a slightly stale set;
   impact is cosmetic staleness only. Worth a one-line repo note that this is an accepted trade-off.

## Proposed Solutions
### Option A — Address in the future admin write-path PR (Recommended)
- When the COA/image upload+delete surface lands: propagate parent soft-delete to children (app-level
  cascade in the same txn, or a trigger), reject image inserts when parent `deleted_at IS NOT NULL`, and
  decide on a `(artwork_id, sort_order)` partial-unique index for reorder semantics. Add the repo note now.
- Effort: Medium (with that PR) · Risk: Low.

### Option B — Add the repo note now, defer the rest
- Only document the two-query trade-off (4) and the CASCADE-vs-soft-delete caveat (1) in code comments
  this PR; leave 1-3 enforcement to the write-path PR.
- Effort: Small · Risk: Low.

## Recommended Action
_(triage)_ — Option A tracked against the write-path ticket; optionally do the doc-comment slice (B) now.

## Technical Details
- Affected (future): `artwork_images` migration (soft-delete propagation / partial-unique), the future
  artwork-images write service, `artwork-read.repository.ts` (doc note).

## Acceptance Criteria
- [ ] Soft-deleting an artwork no longer leaves live orphan `artwork_images` (app cascade or trigger).
- [ ] Image inserts against a soft-deleted parent are rejected.
- [ ] `(artwork_id, sort_order)` uniqueness decision recorded (enforce or explicitly advisory).
- [ ] Two-query non-atomic read documented as an accepted trade-off.

## Resolution (2026-08-24, complete) — Option B (document now; enforce with the write-path ticket)
All four items are **latent/masked today** (no artwork delete path, no image upload path — images are
seed-only, and the detail read 404s on a soft-deleted parent before touching images). The actionable-now
work is documentation so the false-confidence `CASCADE` clause and the accepted staleness are explicit;
the actual enforcement belongs to the future admin write/upload PR, where it is now carried forward:
1. **Soft-delete orphans + 2. FK-on-insert + 3. `(artwork_id, sort_order)` uniqueness** — documented as
   an explicit "future write/upload path" NOTE on the `ArtworkImage` entity: that path must propagate a
   parent soft-delete to children, reject inserts against a soft-deleted parent, and decide the
   uniqueness question. No enforcement added now (nothing to enforce against — no write path exists).
4. **Two-query non-atomic read** — documented as an accepted trade-off directly on
   `ArtworkReadRepository.findOneById` (deliberately un-transactioned to avoid holding a pooled connection
   across signing; concurrent image change → cosmetic staleness only).

Enforcement (1-3) is intentionally **deferred to the admin artwork-images write/upload ticket** — re-open
or link a fresh todo there rather than implementing against a non-existent write surface here.

Verified: build 0, lint clean, artworks integration 8/8.

### Files changed
- `src/modules/fractionalization/entities/artwork-image.entity.ts` (write-path NOTE)
- `src/modules/artworks/repositories/artwork-read.repository.ts` (two-query trade-off note)

## Work Log
- 2026-08-24: Filed from PR #50 review (data-integrity-guardian P3, four grouped items).
- 2026-08-24: Resolved (document-now slice) — entity + repo notes added; enforcement carried to the future write-path ticket. Complete.
