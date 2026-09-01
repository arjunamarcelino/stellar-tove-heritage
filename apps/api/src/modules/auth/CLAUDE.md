# Auth Module

JWT authentication without Passport. Dual-token system with HMAC-SHA256 refresh token hashing.

## Flow

1. **Register:** Validate input -> check email uniqueness -> hash password (bcrypt) -> create user -> generate tokens -> set refresh cookie + return JSON
2. **Login:** Find user by email -> timing-safe bcrypt compare (even for non-existent users) -> generate tokens -> set refresh cookie + return JSON
3. **Refresh:** Read token from body or cookie -> verify via HMAC + timingSafeEqual -> rotate tokens -> set new cookie + return JSON
4. **Logout:** Nullify refresh token hash in DB -> clear httpOnly cookie
5. **Profile:** Read `request.user` from JWT (set by AuthGuard) -> parallel fetch user + current stage via `Promise.all` -> return `ProfileResponseDto`

## SEP-10 Wallet Auth (BYOW)

Coexists with email auth. `Sep10Controller` (`@Controller('auth/sep10')`, `@Public()`, throttled)
serves `POST auth/sep10/challenge` + `POST auth/sep10/verify` under `api/v1`. Wallet-only users have
**null** email/password (see `User` entity + `CHK_users_email_has_hash`); JWT `email` is nullable on
`UserJwtPayload` only, and refresh looks up by `sub` (`findEntityById`), never email.

`Sep10Service` (offline master-key verification — **no Horizon**, so unfunded wallets authenticate):

1. **challenge:** evict oldest outstanding challenges for the pubkey (`pruneOutstanding`, keep cap-1 —
   bounds growth without a hard cap, so a third party can't lock a wallet out) → `WebAuth.buildChallengeTx`
   (server-signed) → persist `auth_challenges` row (tx_hash, xdr, 5-min expiry) → return
   `{ challengeTxXdr, networkPassphrase }`.
2. **verify:** parse XDR (reject fee-bump + any memo) → hash → look up challenge by tx_hash (bind to the
   issued challenge) → classify `NOT_FOUND`/`ALREADY_USED`/`EXPIRED` → `WebAuth.verifyChallengeTxSigners`
   **before** consuming (anti-grief) → atomic compare-and-set consume (`consumeByTxHash`; single-use, race-safe)
   → `WalletsService.findOrCreateForWallet` (reactivates a soft-deleted wallet rather than forking a user)
   → `AuthService.issueTokensForUser` → set refresh cookie.

- **AuthChallenge** entity is ephemeral (no soft-delete); swept on both challenge + verify via
  `deleteExpired` (bounded `LIMIT` + `pg_try_advisory_xact_lock` single-runner).
- Error bodies are static (`Wallet authentication failed` + object-form `errorCode`); XDR/secrets never logged.
- `sep10.config.ts` (`registerAs` + Joi): server signing secret, home/web-auth domain, network passphrase,
  timeout, max-outstanding. Testnet by default.
- **Deferred:** Idempotency-Key retry (re-submit currently → `ALREADY_USED`); scheduled challenge sweep.

## Embedded Passkey Registration (FR-01.02a, TOV-21)

Sibling of SEP-10 for **embedded** wallets. `PasskeyController` (`@Controller('auth/passkey')`,
`@Public()`, throttled) serves `POST auth/passkey/register/begin` (200) + `.../finish` (201) under
`api/v1`. A new user enrolls a **WebAuthn passkey** and the backend deploys a **Soroban smart-wallet**
bound to the passkey's secp256r1 key. Coexists with email/password `/register` and SEP-10; a given
email = one account, one auth method (collision → 409).

### Unified email-first begin/finish (login + signup)

`POST auth/passkey/begin` (200) + `auth/passkey/finish` (200) are the **email-first** surface the FE
uses: the UI collects only an email, and the backend decides the ceremony. `begin` (`PasskeyBeginDto`
= `{ email }`) returns `PasskeyBeginResponseDto { mode, options }`:
- email has an embedded-passkey account → `mode:'login'` + `PublicKeyCredentialRequestOptionsJSON`
  (authentication options, `allowCredentials` scoped to the user's stored credential) → FE calls
  `navigator.credentials.get`.
- brand-new email → `mode:'signup'` + `PublicKeyCredentialCreationOptionsJSON` → FE calls
  `navigator.credentials.create`.
- email registered by a **different** method (email/password, BYOW) → `409 AUTH_EMAIL_CONFLICT` (no
  passkey to log in with, and the email is taken).

`finish` (`PasskeyFinishDto` = `{ email, assertionResponse? | attestationResponse? }`) infers the mode
from **which one field is present** (zero or both → generic `AUTH_PASSKEY_VERIFICATION_FAILED`, no
oracle) and returns `PasskeyRegisterResponseDto { accessToken, refreshToken, contractAddress }` + sets
the refresh cookie. **Always 200** for both (tokens are returned either way; the FE already knows the
mode from `begin` — a dynamic 200/201 would fight Nest's metadata status under `@Res` passthrough).
**Login** (`loginFinish`) verifies the assertion (`verifyAuthenticationResponse`) against the stored
`PasskeyCredential` (public key + counter), resolved by the assertion's credential id and **owner-bound
to the email**, verify-before-consume, then single-use `consumeByChallenge`, advances the signature
counter only when it strictly increases (clone/replay; platform passkeys stay at 0), and issues tokens
— **no chain call** (the wallet already exists). **Signup** delegates to the existing registration
`finish` (deploy + bind). The legacy `register/begin`+`register/finish` remain (marked `deprecated` in
Swagger) and share the same service internals (`registrationBegin`/`persistChallenge`).

`PasskeyService` is a thin orchestrator (Sep10-altitude — holds no `DataSource`):

1. **begin:** reject a taken email → generate WebAuthn options (**ES256/P-256 only**, `attestation:'none'`,
   `residentKey`/`userVerification` required, platform) via `@simplewebauthn/server` → persist a
   `passkey_challenges` row (5-min, evict-oldest per email) → return the options.
2. **finish:** parse the client challenge (wrapped → 401 on malformed) → look up + email-bind the
   challenge → **verify the attestation BEFORE consuming** → decode the COSE key to the 65-byte P-256
   point → **idempotent-replay** a completed registration (same credential+email → re-issue tokens,
   checked before the consumed/expired classification) → classify challenge state → **deploy
   synchronously** (before any DB write; failure → 503 `WALLET_DEPLOY_FAILED`, challenge stays live) →
   delegate the atomic bind to **`WalletsService.createEmbeddedPasskeyWallet`** (consume-in-tx callback +
   `User` + `Wallet`(`kind='embedded_passkey'`) + `PasskeyCredential`; maps 23505 →
   `PASSKEY_ALREADY_BOUND`/`AUTH_EMAIL_CONFLICT`) → `AuthService.issueTokensForUser` → set refresh cookie.
   The **201 body is `PasskeyRegisterResponseDto { accessToken, refreshToken, contractAddress }`** — it
   surfaces the deployed smart-wallet address (from the deploy return on a fresh registration, or the
   bound wallet row on an idempotent replay; no extra chain call). Uses a dedicated DTO, not the shared
   `TokenResponseDto`.

- `PasskeyChallenge` is ephemeral (mirrors `AuthChallenge`, distinct sweep advisory-lock key).
  `PasskeyCredential` belongs to the **wallets** aggregate (1:1 `Wallet`), not auth.
- Relayer deploy is behind the `RELAYER_SERVICE` port (`src/modules/relayer/`); the Soroban adapter
  invokes the real testnet **`tove-wallet-factory.deploy_wallet(salt, [Signer::External(
  webauthnVerifier, key_data)], {})`** (`key_data = secp256r1PubKey(65)‖rawCredentialId`,
  `salt = sha256(rawCredentialId)` — byte-identical to smart-account-kit so the FE derives the same
  address). The canonical wallet WASM hash is stored ON the factory (admin-pinned, `__constructor` /
  `set_wasm_hash`), so it is **no longer a call argument**. `deploy_wallet` is **admin-gated**
  (`admin.require_auth()`), satisfied **admin-as-source**: `RELAYER_FACTORY_ADMIN_SECRET` is BOTH the
  deploy tx source/fee-payer AND signer, so its envelope signature covers `require_auth` — **no
  `authorizeEntry`** (a separately-signed ed25519 admin auth entry is rejected on-chain as
  `scecUnexpectedType`), mirroring the kyc-allowlist / offering-escrow adapters. Deploys serialize on
  a dedicated `relayer:wallet-factory:account:<admin>` lock (the admin's own sequence); the admin
  account must be XLM-funded. A config-gated (`RELAYER_BOOT_PROBE`) `onApplicationBootstrap` probe
  asserts the admin account is funded + on-chain `factory.admin()` == the configured admin key (else
  every deploy would revert `admin.require_auth()` after burning fees). Submissions self-heal
  idempotently: the wallet address is derived off-chain (factory-as-deployer contract-id preimage); a
  proactive existence check skips a redundant deploy, and on ANY deploy failure an on-chain
  `walletExists` re-check (`getLedgerEntries`) self-heals to the derived address only if the contract
  actually exists — error text is never parsed. A stale-sequence (txBAD_SEQ) or throttle
  (TRY_AGAIN_LATER) is transparently retried; every RPC call is timeout-bounded. Tests override it with
  `FakeRelayerService` and drive real crypto via
  `test/shared/webauthn-authenticator.ts`; a gated `RELAYER_LIVE_TESTNET=1` integration test exercises
  the real chain. See `src/modules/relayer/soroban-relayer.service.ts` + `signer-encoding.ts`.
- Config: `webauthn.config.ts` + `relayer.config.ts` (`registerAs` + Joi). New codes:
  `AUTH_PASSKEY_VERIFICATION_FAILED`, `PASSKEY_ALREADY_BOUND` (un-prefixed per AC), `WALLET_DEPLOY_FAILED`;
  challenge classifications reuse the SEP-10 `AUTH_CHALLENGE_*` codes.
- **Testnet only** until mainnet controls (email verification + relayer-balance circuit-breaker +
  global deploy budget) land — `finish` is an unauthenticated, fee-spending endpoint. The adapter now
  deploys against the real testnet factory (addresses + canonical WASM hash in `relayer.config.ts` /
  `.env.example`); mainnet re-deploys the factory + verifiers, so those addresses change (verifiers are
  immutable + shared, one set per network).
- **Email-enumeration posture (accepted):** `register/begin` returns 409 for an already-registered
  email vs 200 for a free one (+ a timing gap), which lets an unauthenticated caller enumerate
  registered emails. This is a conscious, consistent choice with the email/password `/register`
  endpoint; if enumeration ever needs closing, return options unconditionally and defer the conflict
  to `finish` (see todo 101).
- **Idempotent-replay residual risk (accepted, testnet):** the replay branch is *not* a forgery
  oracle (it requires the user's own validly-signed `finish` body), but within the challenge window
  (~5 min, until the sweep) a captured body can re-mint fresh tokens, surviving refresh-token
  revocation. Closing it (an `Idempotency-Key` issued at `begin` and required at `finish`) is folded
  into the mainnet money-surface hardening, not built here. See todo 097.

## Security Patterns

- **Timing-safe login:** `TIMING_SAFE_DUMMY_HASH` constant ensures bcrypt runs even when user doesn't exist (prevents email enumeration)
- **HMAC-SHA256 refresh tokens:** `crypto.createHmac` with dedicated secret, compared via `crypto.timingSafeEqual`
- **Dual-channel refresh:** httpOnly cookie (browsers) + request body (mobile/native)
- **Race condition handling:** Registration catches PostgreSQL `23505` unique constraint violation
- **Cookie scoping:** Refresh cookie path is scoped to `/api/v1/auth/refresh`, httpOnly, secure (non-dev), sameSite strict

## DTOs

- `RegisterDto` -- email, password, firstName, lastName
- `LoginDto` -- email, password
- `RefreshDto` -- refreshToken (optional, falls back to cookie)
- `TokenResponseDto` -- accessToken, refreshToken
- `ProfileResponseDto` -- extends UserResponseDto, adds currentStage (StageProgressDto | null)

## Token Configuration

Secrets and expiry configured via `src/config/jwt.config.ts`. JWT issuer: `tove-api`, audience: `tove-platform`.
