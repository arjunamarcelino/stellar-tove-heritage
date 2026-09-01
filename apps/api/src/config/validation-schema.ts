import * as Joi from 'joi';
import { OFFERING_MAX_BIDS_DEFAULT } from './offering-bid.config';

// Stellar StrKey shapes (base32, RFC 4648 alphabet A-Z2-7): a 56-char contract address (`C…`) and a
// 56-char secret seed (`S…`). Validating the shape (not just the length) fails a misconfigured
// address fast at boot instead of on every deploy inside `Address.fromString`.
const STELLAR_CONTRACT_ADDRESS = /^C[A-Z2-7]{55}$/;
const STELLAR_SECRET_SEED = /^S[A-Z2-7]{55}$/;

export const validationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  BACKOFFICE_API_PREFIX: Joi.string().default('api/backoffice/v1'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),
  DB_MIGRATIONS_RUN: Joi.string().valid('true', 'false').default('true'),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  // Refresh Token HMAC
  REFRESH_TOKEN_HMAC_SECRET: Joi.string().min(32).required(),

  // SEP-10 (Stellar wallet auth)
  SEP10_SERVER_SIGNING_SECRET: Joi.string().length(56).required(),
  SEP10_HOME_DOMAIN: Joi.string().default('tove.io'),
  SEP10_WEB_AUTH_DOMAIN: Joi.string().default('auth.tove.io'),
  SEP10_NETWORK_PASSPHRASE: Joi.string().default('Test SDF Network ; September 2015'),
  SEP10_CHALLENGE_TIMEOUT: Joi.number().integer().min(60).max(900).default(300),
  SEP10_MAX_OUTSTANDING: Joi.number().integer().min(1).default(5),

  // WebAuthn (embedded passkey registration). RP id/origin are security-anchoring
  // → required (fail-fast). WEBAUTHN_ORIGIN is a comma-separated origin allowlist.
  WEBAUTHN_RP_ID: Joi.string().required(),
  WEBAUTHN_RP_NAME: Joi.string().default('Tove'),
  WEBAUTHN_ORIGIN: Joi.string().required(),
  WEBAUTHN_CHALLENGE_TIMEOUT: Joi.number().integer().min(60).max(900).default(300),
  WEBAUTHN_MAX_OUTSTANDING: Joi.number().integer().min(1).default(5),

  // Soroban relayer (smart-wallet deploy). Secret + WASM hash required; RPC/passphrase
  // have safe defaults (tests use the fake relayer, so they are not required()).
  RELAYER_RPC_URL: Joi.string().uri().default('https://soroban-testnet.stellar.org'),
  RELAYER_NETWORK_PASSPHRASE: Joi.string().default('Test SDF Network ; September 2015'),
  RELAYER_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  // Factory admin authority — signs the admin-gated deploy_wallet auth entry (must equal factory.admin()).
  RELAYER_FACTORY_ADMIN_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  RELAYER_BOOT_PROBE: Joi.string().valid('true', 'false').default('true'),
  RELAYER_WALLET_WASM_HASH: Joi.string().hex().length(64).required(),
  // Soroban contract addresses (C-StrKey, 56 chars); per-environment (testnet now).
  RELAYER_FACTORY_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  RELAYER_WEBAUTHN_VERIFIER_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  RELAYER_ED25519_VERIFIER_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).optional(),
  RELAYER_DEPLOY_TIMEOUT_MS: Joi.number().integer().min(5000).max(60000).default(20000),
  // Passkey-signed transfer (TOV-22). USDC token address required (per-env); the rest default
  // (tests use the fake relayer, so they never sign a real fee).
  RELAYER_USDC_TOKEN_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  RELAYER_SUBMIT_TIMEOUT_MS: Joi.number().integer().min(5000).max(60000).default(20000),
  RELAYER_MAX_TX_FEE: Joi.number().integer().min(100).max(100000000).default(10000000),
  RELAYER_MAX_TRANSFER_AMOUNT: Joi.string().pattern(/^\d+$/).default('1000000000000'),
  // OPTIONAL dedicated marketplace-settlement source/fee-payer (TOV-177 #386). Empty = fall back to the shared
  // relayer account. When set it must be a valid Stellar secret seed.
  RELAYER_MARKETPLACE_SETTLEMENT_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).allow('').default(''),
  // Export (TOV-40): comma-separated `address:symbol:decimals` triples (symbol/decimals optional).
  // Each address is a C-StrKey (56 base32 chars); decimals 0-38. Empty = no fraction tokens.
  RELAYER_FRACTION_TOKENS: Joi.string()
    .allow('')
    .pattern(/^[A-Z2-7]{56}(:[^:,]*(:\d{1,2})?)?(,[A-Z2-7]{56}(:[^:,]*(:\d{1,2})?)?)*$/)
    .default(''),

  // FractionToken factory (TOV-233, FR-04.MVP.01). Admin-only per-artwork FractionToken deploy.
  // Two signing seeds (source relayer + factory admin) + the base-infra addresses baked into TokenInit.
  // All required (no default) so a misconfig crash-loops at boot rather than stranding a deploy;
  // RPC/passphrase + bounds have safe defaults. E2E provides throwaway values (the factory port is faked).
  FRACTION_RPC_URL: Joi.string().uri().default('https://soroban-testnet.stellar.org'),
  FRACTION_NETWORK_PASSPHRASE: Joi.string().default('Test SDF Network ; September 2015'),
  FRACTION_RELAYER_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  FRACTION_FACTORY_ADMIN_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  FRACTION_FACTORY_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  FRACTION_TOKEN_WASM_HASH: Joi.string().hex().length(64).required(),
  // proxy_admin / treasury / minter may be a classic (G) or contract (C) address.
  FRACTION_TOKEN_PROXY_ADMIN: Joi.string()
    .pattern(/^[GC][A-Z2-7]{55}$/)
    .required(),
  FRACTION_TREASURY_ADDRESS: Joi.string()
    .pattern(/^[GC][A-Z2-7]{55}$/)
    .required(),
  FRACTION_KYC_ALLOWLIST_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  FRACTION_FREEZE_SET_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  FRACTION_MARKETPLACE_SETTLER_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  // Secondary-marketplace settlement knobs (TOV-177 #387 — fail-fast at boot instead of NaN at runtime). RPC /
  // passphrase are optional (config falls back to the RELAYER_* values); the numeric knobs feed the live accept
  // + is_settled path and the reconcile sweep.
  MARKETPLACE_SETTLEMENT_RPC_URL: Joi.string().uri().optional(),
  MARKETPLACE_SETTLEMENT_NETWORK_PASSPHRASE: Joi.string().optional(),
  MARKETPLACE_SETTLEMENT_READ_TIMEOUT_MS: Joi.number().integer().min(1000).max(60000).default(5000),
  MARKETPLACE_SETTLEMENT_ACCEPT_SIG_LEDGERS: Joi.number().integer().min(1).max(17280).default(120),
  MARKETPLACE_SETTLEMENT_SETTLE_GRACE_MS: Joi.number().integer().min(1000).max(3600000).default(120000),
  MARKETPLACE_SETTLEMENT_RECONCILE_ENABLED: Joi.string().valid('true', 'false').default('true'),
  MARKETPLACE_SETTLEMENT_RECONCILE_CRON: Joi.string().default('* * * * *'),
  MARKETPLACE_SETTLEMENT_RECONCILE_GRACE_MS: Joi.number().integer().min(1000).max(3600000).default(180000),
  MARKETPLACE_SETTLEMENT_RECONCILE_BATCH: Joi.number().integer().min(1).max(1000).default(100),
  FRACTION_MINTER_PLACEHOLDER_ADDRESS: Joi.string()
    .pattern(/^[GC][A-Z2-7]{55}$/)
    .required(),
  FRACTION_USDC_TOKEN_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  FRACTION_DEPLOY_TIMEOUT_MS: Joi.number().integer().min(5000).max(60000).default(20000),
  FRACTION_MAX_TOTAL_SUPPLY: Joi.number().integer().min(1).default(1000000),
  FRACTION_MAX_LOCKUP_DAYS: Joi.number().integer().min(0).max(36500).default(3650),
  FRACTION_RECONCILE_ENABLED: Joi.string().valid('true', 'false').default('true'),
  FRACTION_RECONCILE_CRON: Joi.string().default('*/1 * * * *'),
  FRACTION_RECONCILE_GRACE_MS: Joi.number().integer().min(5000).max(600000).default(25000),
  FRACTION_RECONCILE_BATCH: Joi.number().integer().min(1).max(500).default(20),
  FRACTION_BOOT_PROBE: Joi.string().valid('true', 'false').default('true'),

  // FractionToken balance read (TOV-237, FR-04.MVP.04). Simulate-only, no signing secret — the synthetic
  // read source pubkey is derived from FRACTION_RELAYER_SECRET. RPC/passphrase reuse the fraction values.
  FRACTION_READ_RPC_URL: Joi.string().uri().optional(),
  FRACTION_READ_NETWORK_PASSPHRASE: Joi.string().optional(),
  FRACTION_READ_CONCURRENCY: Joi.number().integer().min(1).max(64).default(8),
  FRACTION_READ_TIMEOUT_MS: Joi.number().integer().min(1000).max(30000).default(5000),
  FRACTION_READ_TOTAL_BUDGET_MS: Joi.number().integer().min(1000).max(60000).default(8000),
  FRACTION_READ_FANOUT_WARN: Joi.number().integer().min(1).max(10000).default(200),
  FRACTION_READ_CACHE_TTL_SECONDS: Joi.number().integer().min(1).max(300).default(30),

  // BYOW USDC trustline check (TOV-32, FR-01.11). No signing secret. `USDC_ASSET_ISSUER` is the CLASSIC
  // USDC issuer (G-address); Joi asserts presence and the config's `StrKey` check does the checksum, so a
  // bad issuer crash-loops at boot. RPC/passphrase fall back to the RELAYER_* values (the config requires
  // one to be set — no silent testnet default).
  USDC_ASSET_ISSUER: Joi.string().required(),
  WALLET_TRUSTLINE_RPC_URL: Joi.string().uri().optional(),
  WALLET_TRUSTLINE_NETWORK_PASSPHRASE: Joi.string().optional(),
  WALLET_TRUSTLINE_TIMEOUT_MS: Joi.number().integer().min(1000).max(30000).default(1200),

  // On-chain KYCAllowlist admin (TOV-235, FR-04.MVP.03a). ONE signing seed = the contract admin AND the tx
  // source (admin.require_auth satisfied by the source-account signature). Contract + secret required (a
  // misconfig crash-loops at boot); RPC/passphrase/bounds default. E2E provides throwaway values (faked port).
  KYC_ALLOWLIST_RPC_URL: Joi.string().uri().default('https://soroban-testnet.stellar.org'),
  KYC_ALLOWLIST_NETWORK_PASSPHRASE: Joi.string().default('Test SDF Network ; September 2015'),
  KYC_ALLOWLIST_CONTRACT_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  KYC_ALLOWLIST_ADMIN_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  KYC_ALLOWLIST_SUBMIT_TIMEOUT_MS: Joi.number().integer().min(5000).max(30000).default(15000),
  KYC_ALLOWLIST_MAX_BATCH: Joi.number().integer().min(1).max(10).default(5),
  KYC_ALLOWLIST_BOOT_PROBE: Joi.string().valid('true', 'false').default('true'),

  // Offering escrow deploy + multi-sig approval (TOV-154, FR-05.02). ONE signing seed = the escrow admin
  // AND the tx source (admin-as-source: admin.require_auth satisfied by the source-account signature).
  // Secret + WASM hash + base-infra addresses required (a misconfig crash-loops at boot);
  // RPC/passphrase/bounds default. Roster/threshold invariants Joi can't express (threshold <= roster,
  // distinct UUIDs) are asserted in the config factory.
  OFFERING_ESCROW_RPC_URL: Joi.string().uri().default('https://soroban-testnet.stellar.org'),
  OFFERING_ESCROW_NETWORK_PASSPHRASE: Joi.string().default('Test SDF Network ; September 2015'),
  OFFERING_ESCROW_ADMIN_SECRET: Joi.string().pattern(STELLAR_SECRET_SEED).required(),
  OFFERING_ESCROW_WASM_HASH: Joi.string().hex().length(64).required(),
  OFFERING_ESCROW_USDC_ADDRESS: Joi.string().pattern(STELLAR_CONTRACT_ADDRESS).required(),
  // treasury may be a classic (G) or contract (C) address.
  OFFERING_ESCROW_TREASURY_ADDRESS: Joi.string()
    .pattern(/^[GC][A-Z2-7]{55}$/)
    .required(),
  OFFERING_ESCROW_POLL_TIMEOUT_MS: Joi.number().integer().min(5000).max(60000).default(30000),
  OFFERING_ESCROW_MAX_TX_FEE: Joi.number().integer().min(100).max(100000000).default(10000000),
  OFFERING_ESCROW_BOOT_PROBE: Joi.string().valid('true', 'false').default('true'),
  OFFERING_ESCROW_RECONCILE_ENABLED: Joi.string().valid('true', 'false').default('true'),
  OFFERING_ESCROW_RECONCILE_CRON: Joi.string().default('*/1 * * * *'),
  OFFERING_ESCROW_RECONCILE_BATCH: Joi.number().integer().min(1).max(500).default(20),
  OFFERING_ESCROW_DEPLOY_GRACE_MS: Joi.number().integer().min(90000).default(120000),
  // TOV-160 settlement: hard active-bid ceiling per offering (on-chain atomic refund-all bound) + the
  // stale-`subscribed` reconcile grace (must exceed two serialized settle txs + backlog).
  OFFERING_MAX_BIDS_PER_OFFERING: Joi.number().integer().min(1).max(500).default(OFFERING_MAX_BIDS_DEFAULT),
  OFFERING_SETTLE_GRACE_MS: Joi.number().integer().min(120000).default(300000),
  OFFERING_SETTLE_RECONCILE_ENABLED: Joi.string().valid('true', 'false').optional(),
  // Approval quorum: CSV roster of admin UUIDs ("the 3"), threshold ("the 2"), and expiry window.
  OFFERING_APPROVAL_SIGNERS: Joi.string().required(),
  // Floor of 2 (todo 284): threshold=1 would collapse the multi-sig to single-sig — a rogue/compromised
  // rostered admin could unilaterally deploy a per-offering money escrow. Enforced here AND in the factory.
  OFFERING_APPROVAL_THRESHOLD: Joi.number().integer().min(2).default(2),
  OFFERING_APPROVAL_TTL_DAYS: Joi.number().integer().min(1).default(7),

  // Offering bid submission (TOV-156). No signing secret (passkey authorizes; relayer keypair is source).
  OFFERING_BID_MAX_COST_STROOPS: Joi.string()
    .pattern(/^(0|[1-9]\d*)$/)
    .default('1000000000000'),

  // Marketplace RFQ notification fan-out (TOV-174). No signing secret (pure DB write). The reconcile sweep
  // is the commit→enqueue crash backstop (disabled in tests); the window must exceed the job retry horizon.
  RFQ_FANOUT_RECONCILE_ENABLED: Joi.string().valid('true', 'false').default('true'),
  RFQ_FANOUT_RECONCILE_CRON: Joi.string().default('* * * * *'),
  RFQ_FANOUT_RECONCILE_WINDOW_MS: Joi.number().integer().min(60000).default(86400000),
  // Recency grace: must exceed the primary job's ~62s retry horizon so a still-retrying fan-out isn't
  // redundantly re-swept. Floor of 90s.
  RFQ_FANOUT_RECONCILE_GRACE_MS: Joi.number().integer().min(90000).default(120000),
  RFQ_FANOUT_RECONCILE_BATCH: Joi.number().integer().min(1).max(1000).default(100),
  RFQ_FANOUT_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(20).default(5),

  // Admin JWT (optional -- falls back to shared JWT secrets if not set)
  ADMIN_JWT_ACCESS_SECRET: Joi.string().min(32).optional(),
  ADMIN_JWT_REFRESH_SECRET: Joi.string().min(32).optional(),
  ADMIN_REFRESH_TOKEN_HMAC_SECRET: Joi.string().min(32).optional(),
  ADMIN_JWT_ACCESS_EXPIRATION: Joi.string().optional(),
  ADMIN_JWT_REFRESH_EXPIRATION: Joi.string().optional(),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // Throttle
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),

  // Supabase Storage
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  SUPABASE_STORAGE_BUCKET: Joi.string().default('files'),
  FILES_SIGNED_URL_TTL: Joi.number().min(60).max(86400).default(3600),

  // KYC (TOV-28, FR-01.07). Envelope-encrypted document storage. `KYC_MASTER_KEY` is the 32-byte KEK
  // (base64) — the blob-hash HMAC key is HKDF-derived from it (no separate secret). Fail-fast at boot:
  // a missing/short key or an empty allowlist crashes rather than mis-encrypting or 422-ing everyone.
  // Required (no default): a missing/typo'd bucket name must fail at boot, not silently 500 every upload
  // at runtime by binding an unintended default bucket (TOV-28 deploy-gate P1-2/P3-1).
  KYC_STORAGE_BUCKET: Joi.string().required(),
  KYC_MASTER_KEY: Joi.string()
    .base64()
    .custom((value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport => {
      return Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid');
    }, 'KYC master key must decode to exactly 32 bytes')
    .required(),
  KYC_MASTER_KEY_VERSION: Joi.number().integer().min(1).default(1),
  KYC_SIGNED_URL_TTL: Joi.number().integer().min(30).max(300).default(90),
  KYC_MAX_CONCURRENT_SUBMISSIONS: Joi.number().integer().min(1).max(100).default(4),
  KYC_SWEEP_ENABLED: Joi.string().valid('true', 'false').default('true'),
  KYC_SWEEP_CRON: Joi.string().default('0 3 * * *'),

  // Beneficiary erasure-reconcile sweep (TOV-31, review todo 418).
  BENEFICIARY_ERASURE_SWEEP_ENABLED: Joi.string().valid('true', 'false').default('true'),
  BENEFICIARY_ERASURE_SWEEP_CRON: Joi.string().default('0 4 * * *'),
  KYC_ORPHAN_GRACE_HOURS: Joi.number().integer().min(1).max(720).default(48),
  KYC_JURISDICTION_ALLOWLIST: Joi.string()
    .default('GB,US,SG')
    .custom((value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport => {
      const codes = value.split(',').map((s) => s.trim()).filter(Boolean);
      return codes.length > 0 ? value : helpers.error('any.invalid');
    }, 'KYC jurisdiction allowlist must be non-empty'),

  // Profile image (TOV-30, FR-01.09). Signed-upload → commit → private derivatives → publish-on-activation.
  // Source bucket required (no default) so a typo fails at boot rather than binding an unintended bucket.
  PROFILE_IMAGE_SOURCE_BUCKET: Joi.string().required(),
  PROFILE_IMAGE_PUBLIC_BUCKET: Joi.string().default('tove-public'),
  PROFILE_IMAGE_MAX_BYTES: Joi.number().integer().min(1024).max(52428800).default(5242880),
  PROFILE_IMAGE_MAINTENANCE_ENABLED: Joi.string().valid('true', 'false').default('true'),
  PROFILE_DERIVATIVE_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(8).default(2),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .optional(),

  // Superadmin seed
  SUPERADMIN_EMAIL: Joi.string().email().optional(),
  SUPERADMIN_PASSWORD: Joi.string().min(12).optional(),
});
