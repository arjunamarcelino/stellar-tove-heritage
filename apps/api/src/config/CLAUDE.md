# Configuration

All application configuration uses the NestJS `registerAs` pattern with typed injection.

## Pattern

```typescript
// 1. Create config factory
export const myConfig = registerAs('my', () => ({
  setting: process.env.MY_SETTING ?? 'default',
}));
export type MyConfig = ReturnType<typeof myConfig>;

// 2. Add to app.module.ts
ConfigModule.forRoot({ load: [..., myConfig] })

// 3. Add to validation-schema.ts (Joi)
MY_SETTING: Joi.string().default('default'),

// 4. Inject with typed token
@Inject(myConfig.KEY)
private readonly my: ConfigType<typeof myConfig>,
```

Never use `configService.get('RAW_STRING')` -- always use typed injection.

## Files

- `app.config.ts` -- port, nodeEnv, corsOrigin, apiPrefix + backofficeApiPrefix (both re-exported from `@common/constants/api-prefix.constant.ts`), trustProxyHops (`TRUST_PROXY_HOPS`, default 1 -- Express `trust proxy` for correct client IP in rate limiting)
- `database.config.ts` -- PostgreSQL connection (uses `database.defaults.ts` for defaults)
- `database.defaults.ts` -- Shared DB defaults for config and CLI data-source
- `jwt.config.ts` -- Access/refresh token secrets and expiry
- `queue.config.ts` -- Redis connection for BullMQ
- `supabase.config.ts` -- Supabase connection (URL, service role key, bucket)
- `files.config.ts` -- File serving config (signed URL TTL)
- `kyc.config.ts` -- KYC submission (TOV-28): private bucket name (**required**, no default), master KEK (`KYC_MASTER_KEY`, base64 32-byte — HKDF sub-keys derive the blob-hash + submission-id HMAC keys) + version, signed-URL TTL, per-file size + concurrency caps, jurisdiction allowlist, and the orphan-sweep enable/cron/grace
- `beneficiary.config.ts` -- Beneficiary designation (TOV-31): the erasure-reconcile sweep toggle + cron (`BENEFICIARY_ERASURE_SWEEP_ENABLED` default true / `_CRON` daily 04:00) — the repeatable backstop that hard-deletes beneficiaries whose owning user is soft-deleted. No secret
- `fraction-factory.config.ts` -- FractionToken deploy (TOV-233): factory/token/base-infra contract addresses + canonical WASM hash + two signing seeds (`FRACTION_RELAYER_SECRET` source, `FRACTION_FACTORY_ADMIN_SECRET` admin — both **non-enumerable** so they can't leak via logging), derived pubkeys for the boot probe, supply/lockup bounds, and the reconcile-sweeper + `FRACTION_BOOT_PROBE` toggles. All contract addresses/seeds **required** (StrKey-validated, fail-fast at boot)
- `fraction-read.config.ts` -- FractionToken balance read (TOV-237, FR-04.MVP.04): powers the simulate-only `GET /v1/me/holdings` fan-out. Holds **no signing secret** (reads never sign) — the synthetic read source pubkey is derived from `FRACTION_RELAYER_SECRET` and asserted a valid StrKey at boot (fail-fast). `rpcUrl`/`networkPassphrase` fall back to the `FRACTION_*` values; tuning knobs: `concurrency` (bounded fan-out), `timeoutMs` (per-call), `totalBudgetMs` (overall request budget), `fanOutWarnThreshold` (warn-only, not a cap), `cacheTtlSeconds` (per-wallet cache)
- `wallet-trustline.config.ts` -- BYOW USDC trustline check (TOV-32, FR-01.11): powers the read-only `getLedgerEntries` check on `POST /me/wallets`. Holds **no signing secret**. `USDC_ASSET_ISSUER` (the **classic** USDC issuer G-address, distinct from the SAC `C…` the money paths use) is **required + StrKey-checksum-validated at load** (fail-fast; set the mainnet issuer before any mainnet cutover); the asset code is hardcoded `'USDC'` (never varies). `rpcUrl`/`networkPassphrase` fall back to the `RELAYER_*` values and **fail fast if neither is set** (no silent testnet default — so a mainnet issuer can't be stamped with a testnet passphrase). `timeoutMs` default 1200ms (fail-open read on the synchronous add path)
- `kyc-allowlist.config.ts` -- on-chain KYC allowlist admin (TOV-235): the KYCAllowlist `KYC_ALLOWLIST_CONTRACT_ADDRESS` + a single `KYC_ALLOWLIST_ADMIN_SECRET` that is BOTH the contract admin AND the tx source (**non-enumerable**; the account must be XLM-funded), derived `adminPublicKey` for the boot probe, `submitTimeoutMs` (per-item confirm poll; the lock TTL is derived from it), and `maxBatch` (≤10) + `KYC_ALLOWLIST_BOOT_PROBE`. Contract + secret **required** (StrKey-validated, fail-fast at boot)
- `offering-escrow.config.ts` -- OfferingEscrow deploy + multi-sig approval (TOV-154, FR-05.02). One `OFFERING_ESCROW_ADMIN_SECRET` = constructor admin AND tx source (admin-as-source, **non-enumerable**; the account must be XLM-funded), derived `adminPublicKey` for the boot probe. `OFFERING_ESCROW_WASM_HASH` (**lowercased at load** — Joi `.hex()` accepts uppercase but the on-chain hash is lowercase, so a mixed-case value would false-mismatch the self-heal), `OFFERING_ESCROW_USDC_ADDRESS`/`_TREASURY_ADDRESS` (baked into the constructor), `pollTimeoutMs` (the Redis lock TTL is **derived from this + fixed RPC bounds**, not a knob), `maxTxFee` (fee cap asserted before signing), `deployGraceMs` (stale-`deploying` reconcile threshold, ≥90s), `probeOnBoot`, reconcile enable/cron/batch. The **approval quorum** lives here too: `OFFERING_APPROVAL_SIGNERS` (CSV roster of admin UUIDs, "the 3") + `OFFERING_APPROVAL_THRESHOLD` ("the 2") + `OFFERING_APPROVAL_TTL_DAYS`. Factory boot assertions Joi can't express (fail-fast): **threshold floor of 2** (a `=1` would collapse the multi-sig to single-sig), threshold ≤ roster size, distinct UUID signers. Contract addrs/secret **required** (StrKey-validated). Own lock key `relayer:offering-escrow:account`. **TOV-160 settlement knobs live here too:** `maxBidsPerOffering` (from a shared `OFFERING_MAX_BIDS_DEFAULT` const in `offering-bid.config`, imported by both configs + Joi so the submit gate and settle belt never drift — the on-chain atomic-settle ceiling; **measure the real testnet cliff before mainnet**), `settleGraceMs` (stale-`subscribed` reconcile threshold, must exceed two serialized settle txs), and `settleReconcileEnabled` (`OFFERING_SETTLE_RECONCILE_ENABLED`, an INDEPENDENT toggle from the deploy sweep, defaulting to it). The `SorobanOfferingEscrowService` boot probe uses a static one-shot latch so binding it in both the deploy + settle worker modules probes the admin account once
- `offering-bid.config.ts` -- Offering bid submission (TOV-156). No signing secret. `maxBidCostStroops` (per-bid USDC ceiling) + `maxBidsPerOffering` (TOV-160, from the shared `OFFERING_MAX_BIDS_DEFAULT` — see offering-escrow.config)
- `throttle.config.ts` -- Rate limiting TTL and limit. `app.module.ts` backs the `ThrottlerModule` with **Redis storage** (`@nest-lab/throttler-storage-redis` on `redis.config`, `lazyConnect`) so per-route `@Throttle` limits are shared across instances / survive restarts (TOV-26 #171)
- `logger.config.ts` -- Pino log level and pretty-print toggle
- `backoffice-jwt.config.ts` -- Admin JWT secrets and expiry (optional, falls back to shared)
- `validation-schema.ts` -- Joi schema validating all env vars at startup

## Exception: route prefixes

`src/common/constants/api-prefix.constant.ts` (`PUBLIC_API_PREFIX`, `BACKOFFICE_API_PREFIX`) reads `process.env` directly -- the ONLY sanctioned bypass of the `registerAs` rule. `RouterModule` prefixes are resolved at module-decoration time, before DI exists, so they cannot be injected. `app.config.ts` re-exports these constants (single source of truth), and `main.ts` runs `import 'dotenv/config'` first so `.env` overrides reach the constants. The Joi schema still defines `API_PREFIX` / `BACKOFFICE_API_PREFIX` for startup validation.
