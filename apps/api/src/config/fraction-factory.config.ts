import { registerAs } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * FractionToken factory config (TOV-233, FR-04.MVP.01). The backend deploys a per-artwork
 * SEP-41 FractionToken by invoking the on-chain `FractionTokenFactory.deploy(TokenInit)` (TOV-137).
 *
 * Two signing keys, both fail-fast via Joi (never logged):
 *  - `relayerSecret` (`FRACTION_RELAYER_SECRET`) — the tx SOURCE account (fees + sequence), on its own
 *    `relayer:fraction:account` lock so admin-deploy bursts never starve user transfers.
 *  - `factoryAdminSecret` (`FRACTION_FACTORY_ADMIN_SECRET`) — signs the `SorobanAuthorizationEntry`
 *    for the factory's `admin.require_auth()`. The boot probe asserts `factory.admin()` == its pubkey.
 *
 * The raw seeds stay off the returned object where practical; only the derived public keys are exposed
 * for the boot probe. All contract addresses are StrKey-validated at boot (a wrong-network address that
 * passes the shape check is caught by the on-chain existence probe, not by stranding a deploy).
 */
export const fractionFactoryConfig = registerAs('fractionFactory', () => {
  const relayerSecret = process.env.FRACTION_RELAYER_SECRET ?? '';
  const factoryAdminSecret = process.env.FRACTION_FACTORY_ADMIN_SECRET ?? '';
  const cfg = {
    rpcUrl: process.env.FRACTION_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.FRACTION_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    // FractionTokenFactory contract (TOV-137) that births one FractionToken per artwork.
    factoryAddress: process.env.FRACTION_FACTORY_ADDRESS ?? '',
    // Canonical FractionToken WASM hash (TOV-146). The factory overrides caller-supplied hashes; we
    // still pass it for record + parity.
    tokenWasmHash: process.env.FRACTION_TOKEN_WASM_HASH ?? '',
    // Deployed token's own upgrade authority (proxy_admin), distinct from the factory admin.
    tokenProxyAdmin: process.env.FRACTION_TOKEN_PROXY_ADMIN ?? '',
    // Base-infra addresses baked into every TokenInit.
    treasuryAddress: process.env.FRACTION_TREASURY_ADDRESS ?? '',
    kycAllowlistAddress: process.env.FRACTION_KYC_ALLOWLIST_ADDRESS ?? '',
    freezeSetAddress: process.env.FRACTION_FREEZE_SET_ADDRESS ?? '',
    marketplaceSettlerAddress: process.env.FRACTION_MARKETPLACE_SETTLER_ADDRESS ?? '',
    // Placeholder minter (replaced at offering approval — out of scope here).
    minterPlaceholderAddress: process.env.FRACTION_MINTER_PLACEHOLDER_ADDRESS ?? '',
    usdcTokenAddress: process.env.FRACTION_USDC_TOKEN_ADDRESS ?? '',
    // Derived pubkeys — logging-safe identity + the boot probe target (asserted == on-chain factory.admin()).
    relayerPublicKey: relayerSecret ? Keypair.fromSecret(relayerSecret).publicKey() : '',
    factoryAdminPublicKey: factoryAdminSecret
      ? Keypair.fromSecret(factoryAdminSecret).publicKey()
      : '',
    deployTimeoutMs: parseInt(process.env.FRACTION_DEPLOY_TIMEOUT_MS ?? '20000', 10),
    // Business bounds enforced in the DTO (fail fast before spending an on-chain tx).
    maxTotalSupply: parseInt(process.env.FRACTION_MAX_TOTAL_SUPPLY ?? '1000000', 10),
    maxLockupDays: parseInt(process.env.FRACTION_MAX_LOCKUP_DAYS ?? '3650', 10),
    // Crash-window reconcile sweeper (promote-only). Disabled in tests.
    reconcileEnabled: (process.env.FRACTION_RECONCILE_ENABLED ?? 'true') === 'true',
    reconcileCron: process.env.FRACTION_RECONCILE_CRON ?? '*/1 * * * *',
    reconcileGraceMs: parseInt(process.env.FRACTION_RECONCILE_GRACE_MS ?? '25000', 10),
    reconcileBatch: parseInt(process.env.FRACTION_RECONCILE_BATCH ?? '20', 10),
    probeOnBoot: (process.env.FRACTION_BOOT_PROBE ?? 'true') === 'true',
  };
  // The two signing seeds are attached NON-ENUMERABLE so they're accessible to the signer
  // (`cfg.relayerSecret`) but excluded from JSON.stringify / util.inspect / spread / Object.keys — a
  // `logger.log(cfg)` or error/DI serialization can never emit a raw seed.
  Object.defineProperty(cfg, 'relayerSecret', { value: relayerSecret, enumerable: false });
  Object.defineProperty(cfg, 'factoryAdminSecret', { value: factoryAdminSecret, enumerable: false });
  return cfg as typeof cfg & { relayerSecret: string; factoryAdminSecret: string };
});

export type FractionFactoryConfig = ReturnType<typeof fractionFactoryConfig>;
