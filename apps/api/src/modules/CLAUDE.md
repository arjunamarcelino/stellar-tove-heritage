# Modules

Feature modules following Clean Architecture. Each module is self-contained with its own controller, service, DTOs, entities, and repository.

## Module Structure

```
modules/{name}/
  {name}.module.ts           # NestJS module definition
  {name}.controller.ts       # HTTP routes
  {name}.service.ts          # Business logic
  dto/
    create-{name}.dto.ts     # Input DTO
    update-{name}.dto.ts     # Partial input DTO
    {name}-response.dto.ts   # Output DTO (never expose entities directly)
  entities/
    {name}.entity.ts         # TypeORM entity extending BaseEntity
  repositories/
    {name}.repository.ts             # TypeORM implementation
    {name}-repository.interface.ts   # Interface contract
```

## Adding a New Module

1. Create the directory structure above
2. Entity extends `BaseEntity` from `src/common/entities/`
3. Repository extends `BaseRepository<T>` and implements its own interface
4. Service injects the repository via interface token
5. Controller uses `@Public()` decorator as needed; backoffice controllers use `@UseGuards(BackofficeGuard)` + `@AdminRoles()`. `@Controller()` takes only the resource name (e.g. `'admins'`) -- the `api/v1` / `api/backoffice/v1` prefix comes from `RouterModule`, not the decorator
6. Module uses `TypeOrmModule.forFeature([Entity])` -- do not re-import `DatabaseModule`
7. Add the leaf module to the right surface's list -- `PUBLIC_MODULES` in `public-api.module.ts` (`api/v1`) or `BACKOFFICE_MODULES` in `backoffice/backoffice.module.ts` (`api/backoffice/v1`). That single array feeds both `RouterModule.register({ children })` and the Swagger `include`. Provider-only modules (no controller) can stay imported directly in `app.module.ts`
8. Add error codes to `ErrorCode` enum (prefixed with domain name)
9. Create migration for the new table (with partial indexes for soft deletes)

## API Surfaces

Controllers are served under two `RouterModule` prefix trees, grouped by module:

- **Public** (`api/v1/...`) -- leaf modules in `PUBLIC_MODULES` (`public-api.module.ts`)
- **Backoffice** (`api/backoffice/v1/...`) -- leaf modules in `BACKOFFICE_MODULES` (`backoffice/backoffice.module.ts`)

A domain shared by both surfaces (e.g. **files/**) lives in its own neutral module that exports its
service; each surface imports it and declares its own controller on top. Neither surface imports the
other. See root `CLAUDE.md` -> "API Surfaces" for the full rationale.

## Current Modules

- **auth/** -- public JWT authentication (login, register, refresh, logout, profile) [`api/v1/auth`] plus **SEP-10 wallet auth** (BYOW): `auth/sep10/challenge` + `auth/sep10/verify`, offline Stellar signature verification, mints wallet-only (null-email) users. Also **embedded passkey registration** (TOV-21): `auth/passkey/register/begin` + `.../finish`, WebAuthn enroll + Soroban smart-wallet deploy. See `auth/CLAUDE.md`.
- **wallets/** -- neutral wallet domain (`Wallet` entity + repo + `WalletsService.findOrCreateForWallet`, atomic user+wallet bind; `Wallet.kind` includes `embedded_passkey`). Owns the `PasskeyCredential` entity + repo (1:1 `Wallet`), `createEmbeddedPasskeyWallet` (atomic user + wallet + credential bind), `resolveEmbeddedWalletForUser` (owner-scoped transfer resolution), and `cose.helper.ts` (COSE->raw-P256). Provider-only + neutral; consumed by `auth` (SEP-10 + passkey). The **`transfer/` subfolder** (TOV-22) is a public surface on top: `PublicWalletTransferModule` -> `WalletTransferController` (`POST api/v1/wallet/transfer/build` + `/submit`, authenticated + owner-scoped) + `WalletTransferService`, added to `PUBLIC_MODULES` (the `files/` precedent). The **`me/` subfolder** (TOV-24) is the authenticated identity surface: `PublicMeWalletsModule` -> `MeWalletsController` on `@Controller('me/wallets')` — `GET /me/wallets` (list), `POST /me/wallets/challenge` (user-bound SEP-10 challenge), `POST /me/wallets` (idempotent BYOW add, `Idempotency-Key` required), `POST /me/wallets/:id/primary` (TOV-25 set primary settlement wallet — active-byow-only, idempotent no-op on re-set, writes a `PRIMARY_CHANGED` audit row), `DELETE /me/wallets/:id` (soft-unbind → `200 {deletedId, newPrimaryWalletId}`; when the target is primary, auto-promotes the oldest eligible byow sibling and reports it, else 409 `PRIMARY_WALLET_CANNOT_BE_REMOVED`). Set-primary + auto-promote run through the shared **`WalletsService.runWithPrimaryContention`** helper — the ONE lock-free primary-concurrency strategy (optimistic `UQ_wallets_primary_active` 23505-catch + demote-retry, no `FOR UPDATE`), also used by bind/reactivate. Orchestration in `MeWalletsService`; the module imports `AuthModule` (for `Sep10Service`, the acyclic direction) + `IdempotencyModule` (`@common/idempotency`, backed by `@config/redis.config`) + the export module + the neutral audit module. `MeWalletsController` ALSO carries the export routes (`:id/export...`) so `DELETE :id` and `GET :id/export` share one controller's static-before-`:param` route ordering. The **`export/` subfolder** (TOV-40) is now **provider-only**: `WalletExportModule` provides + exports `WalletExportService` (the N-transfer drain) — no controller. Export is **non-atomic N single-token transfers** (Soroban = 1 op/tx; the wallet contract has only `transfer()`), so it is stateful/resumable: `wallet_exports` + `wallet_export_items` trackers, single-writer item CAS claim, `FOR UPDATE` completion latch + live-balance-zero gate, and status-read reconciliation for the crash window. Owns `fraction_kyc_allowlist` (read-only KYC gate). Reason→HTTP mapping shared via `@common/http/fail-http` (relayer/`transfer-error-http.ts` re-exports it). See `docs/solutions/integration-issues/soroban-embedded-wallet-export-n-transfer-orchestration.md`. The **`audit/` subfolder** (extracted TOV-25 #158) is the neutral append-only audit facility: `WalletsAuditModule` owns the `internal_audit_log` entity + repo + `AuditLogService` (DB-trigger-enforced append-only), imported by `wallets`, `export`, and `me`. `AuditLogService.record(entry, manager?)` writes in the caller's transaction when a manager is passed (atomic with the audited side effect). `WalletsService` emits genesis `PRIMARY_CHANGED` (`reason:'initial'`) rows on first primary designation (login / passkey / add self-heal / reactivation); the me-surface emits `reason:'user'` (set-primary) and `reason:'auto_promote'` (delete) rows.
- **relayer/** -- provider-only module behind the `RELAYER_SERVICE` port (`SorobanRelayerService`). (1) **Deploy** (TOV-21): deploys passkey-bound Soroban smart-wallets by invoking the real testnet `FractionWalletFactory.deploy_wallet` (single `Signer::External` passkey signer), serialized per account (txBAD_SEQ/throttle transparently retried, RPC calls timeout-bounded) and idempotent via `salt = sha256(rawCredentialId)` + off-chain derivation with an on-chain `walletExists` re-check self-heal, guarded by a Redis `RELAYER_ACCOUNT_LOCK` (one shared key per relayer keypair for deploy AND transfer; in-memory fallback for tests). (2) **Passkey-signed USDC transfer** (TOV-22): `buildTransfer` (simulate-only, returns the tx + the OZ `auth_digest` WebAuthn challenge) + `submitSignedTransfer` (fail-closed `verifyPasskeyAuthorization` -> attach the OZ `AuthPayload` -> re-simulate -> fee cap -> send-only lock -> poll). Pure helpers: `secp256r1.ts` (low-S), `auth-entry-encoding.ts` (OZ `stellar-accounts` v0.7.2 `AuthPayload`, golden-vector-pinned), `passkey-authorization.ts` (now takes optional `expectedTo`/`expectedAmountScaled` — the export surface pins the recipient + exact amount server-side; the transfer surface omits them). (3) **Export reads** (TOV-40): `readWalletHoldings` (read-only `balance()` simulate per token, fail-closed). Token display metadata is config-driven (`RELAYER_FRACTION_TOKENS`), NOT read from chain, to keep display-only concerns off the fail-closed money port. Consumed by `auth` (deploy) + `wallets/transfer` (transfer) + `wallets/export` (holdings read + per-item transfer); tests override with `FakeRelayerService`. See `auth/CLAUDE.md`.
- **users/** -- user domain (no controller; admin HTTP in `backoffice/users`). Email/password are nullable (BYOW wallet-only users). The **`handle/` subfolder** (TOV-26, FR-01.05) is a public surface layered on top: `PublicHandleModule` (in `PUBLIC_MODULES`) with `MeHandleController` (`@Controller('me/handle')`, authenticated GET+POST — read/set the caller's handle, freely-changeable upsert) and `HandlesController` (`@Controller('handles')`, `@Public()` `GET /handles/check` — IP-throttled availability). Handle is a column on `users` (`handle` + DB-generated `handle_canonical = lower(handle)` with partial unique index `WHERE handle_canonical IS NOT NULL AND deleted_at IS NULL`); `UserRepository` gains `findByHandleCanonical`/`setHandle`, `UsersModule` exports the `USER_REPOSITORY` token. Case-insensitive uniqueness + concurrency enforced by the index (23505 → 409 `HANDLE_TAKEN`); format/reserved validated in `HandleService` (→ 422 `HANDLE_FORMAT_INVALID`/`HANDLE_RESERVED`, since the global ValidationPipe emits 400). Pure rules in `handle-format.ts`.
- **collectors/** -- public (`@Public()`) pseudonymous collector profile (TOV-27, FR-01.06) in `PUBLIC_MODULES`: `CollectorsController` (`@Controller('collectors')`, `GET /collectors/:handle`, IP-throttled 30/min) + `CollectorsService`. Resolves the CURRENT handle only, case-insensitively via the **projected** `UserRepository.findPublicProfileByHandleCanonical` (no secret columns hydrated on a public path); old/unknown/soft-deleted/over-length all return an identical `404 COLLECTOR_NOT_FOUND` (no existence oracle). Returns `{ handle, previousHandles[], createdAt }` where `createdAt` is a member-since **date** (`YYYY-MM-DD`, date granularity to limit fingerprinting) and `previousHandles` is deduped-by-canonical, newest-first, current excluded, and `[]` when the collector set `handle_history_public=false`. Imports the neutral `UsersModule` for `USER_REPOSITORY` + `HANDLE_HISTORY_REPOSITORY`. Handle history append + immutability live under `users/` (see `users/CLAUDE.md`).
- **health/** -- liveness/readiness probe via @nestjs/terminus [`api/v1/health`]
- **stages/**, **submissions/** -- public user-facing surfaces [`api/v1`]
- **artworks/**, **artists/** -- anonymous (`@Public()`) public browse [`api/v1/artworks`, `api/v1/artists`]. Mock-data-first: real controllers/services/DTOs backed by an in-memory read repository behind a token (`IArtworkReadRepository` / `IArtistReadRepository`), swappable for a TypeORM repo later (TOV-189/194). See `docs/solutions/code-review-patterns/nestjs-mock-data-first-public-read-module.md`.
- **files/** -- neutral files domain (entity/repo/`FilesService`) + public `FilesProxyController` (`api/v1/files`); admin CRUD is `backoffice/files` (`api/backoffice/v1/files`)
- **storage/** -- Supabase storage abstraction (`IStorageService`)
- **jobs/** -- BullMQ background job processing
- **backoffice/** -- admin surface: auth, admins, dashboard, files, missions, stages, submissions, users [`api/backoffice/v1`]
