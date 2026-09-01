import { registerAs } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Soroban relayer config for embedded smart-wallet deploys. The relayer invokes the
 * admin-gated `tove-wallet-factory.deploy_wallet(salt, signers, policies)` (the
 * canonical wallet WASM hash is now stored ON the factory — set at its construction /
 * `set_wasm_hash` — so it is NO LONGER a call argument). `deploy_wallet` is
 * `admin.require_auth()`, satisfied ADMIN-AS-SOURCE: `RELAYER_FACTORY_ADMIN_SECRET` is BOTH
 * the deploy tx source/fee-payer AND signer (its envelope signature covers require_auth; no
 * authorizeEntry — a separately-signed ed25519 admin entry is rejected on-chain). The admin
 * account must be XLM-funded. `relayerSecret` remains the source for transfers/bids/etc.
 * The factory/verifier addresses + canonical WASM hash are per-environment (testnet now;
 * mainnet is a redeploy with different addresses). Secrets fail fast via Joi and are
 * NON-ENUMERABLE (never logged). `deployTimeoutMs` is the authoritative poll deadline.
 */
export const relayerConfig = registerAs('relayer', () => {
  const relayerSecret = process.env.RELAYER_SECRET ?? '';
  const factoryAdminSecret = process.env.RELAYER_FACTORY_ADMIN_SECRET ?? '';
  const cfg = {
  rpcUrl: process.env.RELAYER_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.RELAYER_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  relayerSecret,
  // Factory admin authority. `deploy_wallet` is admin-gated (`admin.require_auth()`); admin-as-source
  // means this key is BOTH the deploy tx source/fee-payer AND signer (no authorizeEntry). The on-chain
  // `factory.admin()` must equal this key's public key + the account must be funded — asserted at boot.
  factoryAdminSecret,
  // Derived at load so the boot probe / auth-entry filter never touch the secret directly.
  factoryAdminPublicKey: factoryAdminSecret ? Keypair.fromSecret(factoryAdminSecret).publicKey() : '',
  // Fail-fast boot probe toggle (assert relayer funded + factory.admin() match). Disable offline/in tests.
  probeOnBoot: (process.env.RELAYER_BOOT_PROBE ?? 'true') === 'true',
  // OPTIONAL dedicated tx-source/fee-payer for the TOV-177 marketplace accept_quote settlement (perf C1). When
  // set, the settle path sources + signs + locks on this account's OWN lock key, decoupling settlement
  // throughput from the shared bid/transfer/deploy fleet. When empty (default) settlement falls back to the
  // shared relayer account AND its shared lock key (no sequence race). It only pays fees + provides the tx
  // source; the buyer/seller passkey entries carry the authorization, so it needs no allowlist/KYC.
  marketplaceSettlementSecret: process.env.RELAYER_MARKETPLACE_SETTLEMENT_SECRET ?? '',
  // Canonical smart-wallet WASM hash. NO LONGER passed to deploy_wallet (the factory stores it
  // internally); kept for the boot-probe cross-check against on-chain `factory.wasm_hash()` and
  // documentation of which audited build the deployed wallets run.
  walletWasmHash: process.env.RELAYER_WALLET_WASM_HASH ?? '',
  // FractionWalletFactory contract that deploys per-user wallets.
  factoryAddress: process.env.RELAYER_FACTORY_ADDRESS ?? '',
  // Shared, immutable OZ WebAuthn (secp256r1) verifier bound as the passkey signer.
  webauthnVerifierAddress: process.env.RELAYER_WEBAUTHN_VERIFIER_ADDRESS ?? '',
  // Shared Ed25519 verifier for a future recovery signer (stored now, unused for MVP).
  ed25519VerifierAddress: process.env.RELAYER_ED25519_VERIFIER_ADDRESS ?? '',
  deployTimeoutMs: parseInt(process.env.RELAYER_DEPLOY_TIMEOUT_MS ?? '20000', 10),
  // --- Passkey-signed transfer (TOV-22) ---
  // USDC SAC token contract the wallet transfers; per-environment (testnet now).
  usdcTokenAddress: process.env.RELAYER_USDC_TOKEN_ADDRESS ?? '',
  // Wall-clock deadline for the transfer submit poll (distinct from the deploy poll).
  submitTimeoutMs: parseInt(process.env.RELAYER_SUBMIT_TIMEOUT_MS ?? '20000', 10),
  // Hard ceiling (stroops) on the total tx fee the relayer will ever sign — the round-tripped
  // envelope's fee is never trusted; it is re-derived from simulation and capped here.
  maxTxFeeStroops: parseInt(process.env.RELAYER_MAX_TX_FEE ?? '10000000', 10),
  // Per-transfer amount ceiling (scaled i128 as a decimal string) — a WebAuthn assertion signs an
  // opaque hash (no on-device amount display), so a server-side cap compensates. Default ~100k USDC.
  maxTransferAmount: process.env.RELAYER_MAX_TRANSFER_AMOUNT ?? '1000000000000',
  // --- Embedded-wallet export (TOV-40) ---
  // Fraction (SEP-41) tokens an export enumerates balances for, alongside USDC. Comma-separated
  // `address:symbol:decimals` triples (symbol/decimals optional → default '', 0), e.g.
  // "CABC…:ART:0,CDEF…:XYZ:0". StrKeys are base32 (no ':'), so ':' is a safe delimiter. This carries
  // the (immutable) display metadata so it is NOT re-read from Soroban on every initiate; the durable
  // per-wallet holdings source (M04 registry) replaces this behind the live-balance-zero gate.
  fractionTokens: (process.env.RELAYER_FRACTION_TOKENS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [address, symbol, decimals] = entry.split(':');
      return { address, symbol: symbol ?? '', decimals: Number.parseInt(decimals ?? '0', 10) || 0 };
    }),
  };
  // Keep the signing secrets off enumeration (logging / serialization) — mirrors fraction-factory.config.
  Object.defineProperty(cfg, 'relayerSecret', { value: relayerSecret, enumerable: false });
  Object.defineProperty(cfg, 'factoryAdminSecret', { value: factoryAdminSecret, enumerable: false });
  return cfg;
});

export type RelayerConfig = ReturnType<typeof relayerConfig>;
