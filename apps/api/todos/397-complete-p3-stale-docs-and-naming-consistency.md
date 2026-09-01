---
status: complete
priority: p3
issue_id: 397
tags: [code-review, tov-189, pr-50, documentation, consistency, architecture]
dependencies: []
---
# Stale comments, naming anomalies, and ownership docs from the mock→DB swap

## Problem Statement
The PR left a few now-false narrative comments and minor naming/consistency divergences introduced by the
swap. Cosmetic, but they are exactly the cross-module contracts a future editor will trust.

## Findings
1. **Stale `Artwork` entity class-docs (now contradicted by this PR).**
   `src/modules/fractionalization/entities/artwork.entity.ts:6-9` still says the public browse
   `ArtworkStatus` is "`verified | published`" — but the live visibility set is
   `['verified','fractionalized']` (`artwork-visibility.constant.ts:13`); `published` is now hidden,
   `fractionalized` visible (comment inverts the real policy). Lines `:15-16` still say the public browse
   "still serves an in-memory read model (TOV-189 unifies them)" — this PR **is** TOV-189 and deleted the
   mock; the read model is DB-backed. (architecture/docs)
2. **Repo class name carries a `TypeOrm` prefix no other repo uses + file/class mismatch.**
   `artwork-read.repository.ts:24` — class `TypeOrmArtworkReadRepository`. Every other TypeORM repo is
   `<Domain>Repository` (`UserRepository`, `OfferingRepository`, sibling `ArtworkRepository`); the only
   strategy-prefixed class is the *mock* `InMemoryArtistRepository`, whose file also carries the prefix.
   Here the class says `TypeOrm…` but the file is `artwork-read.repository.ts`. Established pattern →
   `ArtworkReadRepository` (still distinct via `Read` + the `IArtworkReadRepository` token). (pattern)
3. **`ArtworkImage` ownership is nominal — the owning module never references it.**
   `artwork-image.entity.ts` lives under `fractionalization/entities/` but `fractionalization.module.ts`
   registers only `[Artwork, FractionContract]`; nothing in fractionalization references it (no relation,
   service, or CLAUDE.md line). Its only runtime registration is the consumer's `forFeature`
   (`artworks.module.ts:19`). Defensible as an `Artwork`-aggregate child, but add a one-line ownership
   note to the fractionalization docs (or reconsider homing a read-only public entity in the read
   module). (architecture)
4. **Read-only boundary is convention-only.** `artwork-read.repository.ts:28-31` composes
   `DataSource.getRepository(...)` → full write-capable `Repository<T>` handles; nothing structurally
   stops a future edit calling `.save()`/`.update()` and bypassing fractionalization's status-CAS. Add a
   class-doc contract line ("read-only; never writes"), or narrow to a read surface. (architecture)
5. **Migration `down()` message omits the `NODE_ENV` fragment every sibling includes.**
   `1716000000046-…:70` — other guarded `down()`s end with `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`
   so an operator sees which env tripped it. (pattern, operator-facing)
6. **`insertArtwork` seed helper diverges from the `insertOffering` precedent.**
   `test/shared/seed-artwork.ts:45` hardcodes `ON CONFLICT DO NOTHING` + returns the local id with no
   `RETURNING`; `insertOffering` gates conflict behind an opt-in flag and uses `RETURNING "id"` with a
   fallback. The two shared seeders are presented as parallel in `test/CLAUDE.md`. (pattern)
7. **Minor TS niceties.** DTO factory verbs differ (`ArtworkResponseDto.fromRecord` vs
   `ArtworkDetailResponseDto.build`) — `build` justified by the 2nd arg but the pair reads as unrelated;
   `PublicArtworkStatus` type is imported via a re-export hop through the interface file while its value
   tuple comes from the constants file. Both compile; consider importing the type from where it's
   declared and/or aligning factory names. (typescript)

## Proposed Solutions
### Option A — One small docs/naming cleanup pass (Recommended)
- Fix the two stale `artwork.entity.ts` comments (1); rename `TypeOrmArtworkReadRepository` →
  `ArtworkReadRepository` (2); add the fractionalization ownership note + read-only class-doc line (3,4);
  add the `NODE_ENV` fragment to the migration message (5); align `insertArtwork` to the `insertOffering`
  shape or note the difference (6); optionally the TS niceties (7).
- Effort: Small · Risk: Low (comments/names/tests only; rename is a mechanical refactor).

## Recommended Action
_(triage)_ — Option A; safe to batch. The stale entity comments (1) are the most important (they misstate
a live cross-module policy).

## Technical Details
- Affected: `artwork.entity.ts`, `artwork-read.repository.ts` (+ imports of the class), `fractionalization`
  CLAUDE.md, migration `…046`, `test/shared/seed-artwork.ts`, the two DTOs, the interface re-export.

## Acceptance Criteria
- [ ] `artwork.entity.ts` comments reflect the real visible set + DB-backed read model.
- [ ] Read repo class renamed to match the filename + house convention (or the anomaly justified).
- [ ] `ArtworkImage` ownership + the repo's read-only contract are documented.
- [ ] Migration message includes the `NODE_ENV` fragment; `insertArtwork` aligned/noted.

## Resolution (2026-08-24, complete)
1. **Stale `Artwork` entity comments** — fixed both: the public-visible set now reads
   `verified | fractionalized` (was `verified | published`), and the class doc now says the public browse
   reads the table directly (DB-backed) since TOV-189 (was "still serves an in-memory read model").
2. **Repo class name** — renamed `TypeOrmArtworkReadRepository` → `ArtworkReadRepository` across the class,
   `artworks.module.ts`, the integration spec, and `src/modules/CLAUDE.md` (matches the filename + the
   `<Domain>Repository` house convention; stays distinct via the `Read` qualifier + `IArtworkReadRepository`).
3. **`ArtworkImage` ownership** — already documented in `src/modules/CLAUDE.md` (fractionalization entry:
   "co-located here as the same aggregate, consumed read-only by artworks/"); left as-is.
4. **Read-only boundary** — added a class-doc contract line to `ArtworkReadRepository`: it must never write;
   mutations go through fractionalization's status CAS (the composed handles are write-capable → convention,
   not a type guarantee).
5. **Migration message** — appended `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'})` to the `down()` refusal.
6. **`insertArtwork` seed helper** — aligned to the `insertOffering` shape: opt-in `onConflictDoNothing`
   flag (default off) + `RETURNING "id"` with a deterministic-id fallback.
7. **TS niceties** — DTO factory verbs (`fromRecord` vs `build`) left as-is (`build`'s second `signed` arg
   is the deliberate signal); the `PublicArtworkStatus` re-export hop left as-is (the interface is the DTOs'
   natural dependency and legitimately re-exports the type it uses). Non-issues; documented as conscious keeps.

Verified: build 0, lint clean, artworks integration 8/8, e2e 7/7.

## Work Log
- 2026-08-24: Filed from PR #50 review (architecture P2/P3, pattern P3, kieran-ts P3 — grouped).
- 2026-08-24: Resolved — stale comments fixed, class renamed, read-only/ownership docs, migration message, seed align; TS niceties consciously kept. Complete.
