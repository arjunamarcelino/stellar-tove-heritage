import * as Joi from 'joi';

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
  // Export (TOV-40): comma-separated `address:symbol:decimals` triples (symbol/decimals optional).
  // Each address is a C-StrKey (56 base32 chars); decimals 0-38. Empty = no fraction tokens.
  RELAYER_FRACTION_TOKENS: Joi.string()
    .allow('')
    .pattern(/^[A-Z2-7]{56}(:[^:,]*(:\d{1,2})?)?(,[A-Z2-7]{56}(:[^:,]*(:\d{1,2})?)?)*$/)
    .default(''),

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

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .optional(),

  // Superadmin seed
  SUPERADMIN_EMAIL: Joi.string().email().optional(),
  SUPERADMIN_PASSWORD: Joi.string().min(12).optional(),
});
