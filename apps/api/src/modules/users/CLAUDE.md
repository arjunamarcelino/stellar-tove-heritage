# Users Module

Domain module for platform users: entity, repository, and service. No controller -- the HTTP layer lives in `src/modules/backoffice/users/` (`BackofficeUsersController`), following the same split pattern as submissions.

## Entity

`User` extends `BaseEntity` with: email (citext, unique, **nullable**), passwordHash (bcrypt, **nullable**), firstName, lastName, isActive, refreshTokenHash (nullable). Email/password are nullable so BYOW wallet-only users (SEP-10, see `auth/CLAUDE.md`) can exist without credentials; a DB `CHK_users_email_has_hash` enforces "email present ⇒ password present". The `normalizeEmail`/`validatePasswordHash` hooks are null-tolerant.

### Entity Lifecycle Hooks

- `normalizeEmail()` -- `@BeforeInsert`/`@BeforeUpdate`: lowercases and trims email
- `validatePasswordHash()` -- `@BeforeInsert`/`@BeforeUpdate`: validates passwordHash starts with `$2` (bcrypt prefix)

## Repository

`UserRepository extends BaseRepository<User>` implements `IUserRepository`.

Interface in `repositories/user-repository.interface.ts`. Custom method: `findByEmail(email: string)`.

### Handle history (TOV-27, FR-01.06)

`UserRepository.setHandle` is **transactional** (`runInTransaction`): it SELECTs the caller's own row
**`FOR UPDATE`** (`lock: pessimistic_write` — serializes concurrent same-user renames so change-detection
can't read stale state), UPDATEs `users.handle` (the 23505 still surfaces → 409), and — only on a real
canonical change — appends a row to the append-only **`handle_history`** table via
`HandleHistoryRepository.record(userId, handle, manager)` (mirrors `InternalAuditLogRepository.record`, so the
foreign-entity write flows through its owning repo, atomically inside the same manager). `UserRepository`
therefore `@Inject`s `HANDLE_HISTORY_REPOSITORY` — **any test module that hand-rolls `UserRepository` must
also provide that token** (users/auth/handle integration modules do). No-op / case-only re-sets append nothing.
`HandleHistory` (`user_id` FK, `handle`, DB-generated `handle_canonical`, `created_at`; NOT `BaseEntity`) is
UPDATE-immutable via a `BEFORE UPDATE`-only trigger (migration …024) — un-editable but NOT un-deletable, so the
FK `ON DELETE CASCADE` (+ a future admin-erase) still purges. Read side (token `HANDLE_HISTORY_REPOSITORY`):
`listByUserId` (capped 50, `created_at DESC`, index-covered). The public `collectors/` module reads the current
holder via `UserRepository.findPublicProfileByHandleCanonical` (**projected** — no secret columns hydrated).
`users.handle_history_public` (default true) is the per-collector opt-out — when false the public profile hides
`previousHandles`; toggled via `PATCH /me/handle/history`.

## Service

`UsersService` handles:
- `create()` -- hashes password via bcrypt, creates user, returns DTO
- `findAll()` -- paginated list with PaginatedResponseDto
- `findOne()` -- by UUID
- `update()` -- partial update (uses save() for lifecycle hooks)
- `softDelete()` -- nullifies refreshTokenHash then soft-removes (2 queries, not 3)

## Soft Delete

Uses `@DeleteDateColumn()` from BaseEntity. TypeORM auto-appends `WHERE deleted_at IS NULL`. The `softDelete()` method clears `refreshTokenHash` before soft-removing to prevent continued session access.

⚠️ **Handle restore invariant (TOV-26):** the `UQ_users_handle_canonical_active` partial index excludes soft-deleted rows, so a soft-deleted collector's handle is **released** and can be re-claimed by another collector. If a future feature ever **restores/undeletes** a user (`deleted_at → NULL`) whose handle was re-claimed, the restore write will hit `23505` on the handle index — on a path OUTSIDE `HandleService.setHandle`'s catch, surfacing as a raw 500. Any restore path MUST clear/rename `handle` on restore (or catch 23505 and force re-selection). No restore path exists today. See migration `1716000000023` and the TOV-26 plan (AC16).

## DTOs

- `CreateUserDto` -- email, password, firstName, lastName
- `UpdateUserDto` -- PartialType of CreateUserDto
- `UserResponseDto` -- excludes passwordHash and refreshTokenHash
