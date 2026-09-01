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

⚠️ **Compliance data on the soft-deleted row (TOV-29):** `whitelisted_at` and `kyc_reason` (a machine-readable freeze/removal code) are compliance-lifecycle data that live directly on `users` and persist through soft-delete (`softDelete()` only nullifies `refreshTokenHash`). Two obligations: (1) a future **right-to-erasure** flow MUST null `kyc_reason` + `whitelisted_at` alongside other PII — they are not covered today. (2) These columns are only meant to be surfaced by `WhitelistStatusResponseDto` (which gates `kyc_reason` to `frozen`/`removed` and validates it is a code). Do NOT return a full `User` entity directly (`res.json(user)` / `instanceToPlain`) or emit it from a non-projected finder path — `UserResponseDto` and the whitelist DTO are the only sanctioned serializers, and both allowlist fields. `findByEmail`/`findByHandleCanonical` hydrate the full row (incl. these columns) but their results only ever reach clients via `UserResponseDto.fromEntity`.

## DTOs

- `CreateUserDto` -- email, password, firstName, lastName
- `UpdateUserDto` -- PartialType of CreateUserDto
- `UserResponseDto` -- excludes passwordHash and refreshTokenHash

## Beneficiary designation (TOV-31, FR-01.10)

The **`beneficiary/` subfolder** is the inheritance-beneficiary surface, split neutral/erasure/public
like `profile/`: a neutral **`BeneficiaryModule`** owns the `Beneficiary` entity + `BENEFICIARY_REPOSITORY`
(manager-aware `findByUserId`/`createForUser`/`applyUpdate`/`deleteByUserId`); a neutral
**`BeneficiaryErasureModule`** exports `BeneficiaryErasureService.purgeForUser` (imported by
`BackofficeUsersModule`, called in the admin delete path next to `profileErasure`); and
**`PublicBeneficiaryModule`** (in `PUBLIC_MODULES`) declares `MeBeneficiaryController` on
`@Controller('me/beneficiary')` — `GET`/`POST`/`DELETE`, owner-scoped, all returning
`{ beneficiary, notice }`. **Removal is a HARD delete** (third-party PII must not linger — the entity
still extends `BaseEntity`, so the `deleted_at` column + partial-unique `UQ_beneficiaries_user_active`
exist for TypeORM conformance but stay NULL; `deleteByUserId` uses `DELETE … RETURNING id` to avoid a
spurious audit under concurrency). The hard-delete-only invariant is **DB-enforced** by a `BEFORE UPDATE`
guard trigger (migration `051`) that rejects setting `deleted_at`, and the **`erasure-sweep/` subfolder**
(provider-only `BeneficiaryErasureSweepModule`, in `app.module`) is a repeatable BullMQ backstop that
hard-deletes beneficiaries of soft-deleted users — the safety net for the best-effort per-account purge
(config `beneficiary.config.ts`: `BENEFICIARY_ERASURE_SWEEP_ENABLED`/`_CRON`). `POST` is a **full-replace
(PUT) upsert** (omitted optional → `null`) with a bounded retry over the `23505` insert race AND the
concurrent-delete-mid-update (`applyUpdate` guards `WHERE id`, re-inserts on 0 rows; exhaustion → a clean
retryable 503, never a bare 500); the DB write + `internal_audit_log` write (`beneficiary.set`/
`beneficiary.removed`, **keys-only** payload — no PII) run in one txn via `WalletsAuditModule`. The `notice`
(`{ code:'KYC_REQUIRED_FOR_TRANSFER' } | null`, gated `satisfies Record<KycStatus,boolean>`, **fail-safe**:
drift → shown) is derived from `UserRepository.findKycStatusByUserId` — **KYC is not required to write**.
Validation is structural (global 400); no new `ErrorCode`. Migrations `1716000000050` (table) +
`1716000000051` (guard trigger). Reusable pattern: `docs/solutions/code-review-patterns/nestjs-hard-delete-third-party-pii-table.md`; plan/contract/runbook in `docs/`.
