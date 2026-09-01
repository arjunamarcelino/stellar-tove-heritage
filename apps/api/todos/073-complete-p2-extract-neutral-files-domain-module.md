---
status: complete
priority: p2
issue_id: 073
tags: [code-review, architecture, modules]
dependencies: []
---

# Public Files Surface Depends on the Backoffice Module (Dependency Inversion)

## Problem Statement
`PublicFilesModule` (public surface) imports the backoffice `FilesModule` purely to borrow `FilesService`, and the public `FilesProxyController` physically lives at `src/modules/backoffice/files/files-proxy.controller.ts`. This makes the less-privileged public surface structurally depend on the more-privileged backoffice surface, and splits the "files" domain across two directories. A change to backoffice `FilesModule` internals can break the public proxy. The shared asset (`FileEntity`, `FileRepository`, `FilesService`) is really a neutral files domain that belongs to neither surface.

## Findings
- `src/modules/files/public-files.module.ts:2-3,14-16` — imports `FilesModule` and `FilesProxyController` from `@modules/backoffice/files/...`.
- `src/modules/backoffice/files/files.module.ts` — now `exports: [FilesService]` solely to feed the public module.
- Two "files" locations with split ownership; violates "each module is self-contained" (`src/modules/CLAUDE.md`).
- Flagged by architecture (P2), TypeScript (P3), pattern (P3).

## Proposed Solutions

### Option A: Extract a neutral shared files-domain module
- **Description:** New shared `FilesModule` (entity + repository + `FilesService`, `exports: [FilesService]`). `BackofficeFilesModule` imports it and declares the guarded admin `FilesController`; `PublicFilesModule` imports it and declares `FilesProxyController` (moved to `src/modules/files/`). Neither surface depends on the other.
- **Pros:** Correct seam; removes inversion; co-locates the public controller with its module; kills the cross-surface Swagger-leak concern entirely.
- **Cons:** Moves several files; touches imports across the backoffice files module.
- **Effort:** Medium
- **Risk:** Low-Medium (mechanical; covered by e2e)

### Option B: Move only the proxy controller into src/modules/files/
- **Description:** Relocate `files-proxy.controller.ts` next to `public-files.module.ts`; keep `FilesService` exported from backoffice `FilesModule`.
- **Pros:** Fixes the "public controller under backoffice/" smell with less churn.
- **Cons:** Public surface still imports the backoffice module (inversion remains).
- **Effort:** Small
- **Risk:** Low

### Option C: Accept as-is (documented)
- **Description:** Keep current wiring; it is correct and commented.
- **Pros:** Zero work.
- **Cons:** Leaves the structural coupling the PR was meant to separate.
- **Effort:** None
- **Risk:** Low

## Recommended Action
Option A — extract a neutral shared files-domain module (confirmed by user).

## Implemented Solution
Applied **Option A** (full extraction). Moved the files domain out of the backoffice tree into
a neutral `src/modules/files/` (git mv, history preserved):

### New structure
- `src/modules/files/` (neutral domain, imported by both surfaces):
  - `files.module.ts` — `TypeOrmModule.forFeature([FileEntity])` + `StorageModule`; providers
    `IFileRepository` + `FilesService`; `exports: [FilesService]`. **No controllers.**
  - `entities/file.entity.ts`, `repositories/file.repository.ts` (+ interface), `dto/*`,
    `files.service.ts` — moved here.
  - `public-files.module.ts` — imports the shared `FilesModule`, declares `FilesProxyController`
    (also moved here). Serves `api/v1/files/...`.
- `src/modules/backoffice/files/`:
  - `backoffice-files.module.ts` (renamed from `files.module.ts`) — imports the shared
    `FilesModule` + `JwtModule`, declares the guarded `FilesController`, provides
    `BackofficeGuard`. Serves `api/backoffice/v1/files`.
  - `files.controller.ts` — stays; imports `FilesService`/DTOs from `@modules/files/...`.

Neither surface depends on the other; both depend on the neutral `FilesModule`. `BackofficeModule`
now imports `BackofficeFilesModule` (in `BACKOFFICE_MODULES`). Unit test moved to
`test/unit/modules/files/` with updated imports. `files.service.ts` storage import switched from
`../../storage/...` to the `@modules/storage/...` alias.

### Verification
- Build clean (145 files); unit 164, integration 9, e2e 36 green; lint clean.
- Runtime smoke test: `GET /api/v1/files/foo` → 404 (public, unguarded); `GET /api/backoffice/v1/files`
  → 401 (guarded). Public Swagger contains `/api/v1/files/{urlPath}` and does **not** leak any
  backoffice files path; backoffice Swagger contains `/api/backoffice/v1/files`.

## Technical Details
- Moved: entity, repository (+interface), 3 DTOs, `files.service.ts`, `files-proxy.controller.ts` → `src/modules/files/`.
- New/renamed: `src/modules/files/files.module.ts`, `backoffice/files/backoffice-files.module.ts`.
- Updated: `public-files.module.ts`, `backoffice.module.ts`, `backoffice/files/files.controller.ts`, unit test.

## Acceptance Criteria
- [x] Public surface no longer imports a backoffice module; the proxy controller lives in `src/modules/files/`.
- [x] `api/v1/files/:urlPath` and `api/backoffice/v1/files` both resolve; e2e green.
- [x] Swagger public doc shows only `FilesProxyController`; backoffice doc shows only `FilesController` (verified — no cross-surface leak).

## Work Log
- 2026-07-01: Filed from PR #17 review (architecture-strategist et al.).
- 2026-07-01: User chose full extraction (Option A). Extracted neutral `FilesModule`, moved domain + proxy controller into `src/modules/files/`, created `BackofficeFilesModule`. Verified build + unit 164 + integration 9 + e2e 36 + runtime smoke + Swagger separation.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/17
