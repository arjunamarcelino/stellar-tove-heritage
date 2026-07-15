import { registerAs } from '@nestjs/config';

/**
 * Soroban relayer config for embedded smart-wallet deploys. The relayer invokes
 * `FractionWalletFactory.deploy_wallet(wasm_hash, salt, signers, policies)`; the
 * factory address, WebAuthn verifier address, and canonical wallet WASM hash are
 * per-environment (testnet now; mainnet is a redeploy with different addresses).
 * `relayerSecret` + the required addresses/hash fail fast via Joi; never log the
 * secret. `deployTimeoutMs` is the authoritative wall-clock deadline for the poll.
 */
export const relayerConfig = registerAs('relayer', () => ({
  rpcUrl: process.env.RELAYER_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.RELAYER_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  relayerSecret: process.env.RELAYER_SECRET ?? '',
  // Canonical smart-wallet WASM hash passed to the factory's deploy_wallet.
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
}));

export type RelayerConfig = ReturnType<typeof relayerConfig>;
