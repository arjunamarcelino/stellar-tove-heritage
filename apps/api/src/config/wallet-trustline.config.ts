import { registerAs } from '@nestjs/config';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * BYOW USDC-trustline read config (TOV-32, FR-01.11). Powers the simulate-free, single-read
 * `getLedgerEntries` check that decides whether `POST /v1/me/wallets` returns a `change_trust`
 * instruction. Holds NO signing secret — the read signs nothing and the emitted `change_trust` XDR is
 * a seq=0 template the user's wallet signs.
 *
 * USDC is Circle's CLASSIC asset wrapped as a SAC, so a BYOW G-account needs a classic trustline to
 * receive it. `usdcAssetIssuer` (the classic issuer G-address) and the network passphrase are
 * validated at load — a missing/invalid value fails boot rather than shipping a silently-broken
 * receive flow. `rpcUrl`/`networkPassphrase` fall back to the `RELAYER_*` values.
 */
export const walletTrustlineConfig = registerAs('walletTrustline', () => {
  // StrKey does the real (checksum) validation; the Joi schema only asserts presence.
  const usdcAssetIssuer = process.env.USDC_ASSET_ISSUER ?? '';
  if (!StrKey.isValidEd25519PublicKey(usdcAssetIssuer)) {
    throw new Error('wallet-trustline config: USDC_ASSET_ISSUER must be a valid Stellar public key (G...)');
  }
  // Network-critical: no silent testnet default. The RELAYER_* fallback is INTENTIONAL — the wallets
  // domain's Soroban reads run on the relayer's network, and the app has no single shared "network"
  // config (the fraction-read mirror borrows FRACTION_* the same way). Fail fast if neither is set, so
  // a mainnet issuer can never be stamped with a testnet passphrase (or hit the wrong RPC).
  const networkPassphrase =
    process.env.WALLET_TRUSTLINE_NETWORK_PASSPHRASE ?? process.env.RELAYER_NETWORK_PASSPHRASE ?? '';
  const rpcUrl = process.env.WALLET_TRUSTLINE_RPC_URL ?? process.env.RELAYER_RPC_URL ?? '';
  if (!networkPassphrase) {
    throw new Error(
      'wallet-trustline config: WALLET_TRUSTLINE_NETWORK_PASSPHRASE (or RELAYER_NETWORK_PASSPHRASE) is required',
    );
  }
  if (!rpcUrl) {
    throw new Error('wallet-trustline config: WALLET_TRUSTLINE_RPC_URL (or RELAYER_RPC_URL) is required');
  }
  return {
    rpcUrl,
    networkPassphrase,
    usdcAssetIssuer,
    // Fail-open read on the SYNCHRONOUS add path: a stalled RPC adds this to the add's P99 latency (the
    // wallet is already bound), so keep it tight — matches the RFQ balance-advisor precedent (~1.2s).
    timeoutMs: parseInt(process.env.WALLET_TRUSTLINE_TIMEOUT_MS ?? '1200', 10),
  };
});
