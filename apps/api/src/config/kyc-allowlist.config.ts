import { registerAs } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * On-chain KYCAllowlist admin config (TOV-235, FR-04.MVP.03a). The backend adds/removes Collector
 * smart-wallet contract addresses on the deployed KYCAllowlist contract (TOV-141) by submitting
 * `add(addr)` / `remove(addr)` Soroban transactions serially (Soroban allows one tx per source account
 * per ledger, so a batch cannot be pipelined — see docs/plans/2026-07-18…-plan.md).
 *
 * ONE signing seed (`adminSecret`): the KYCAllowlist contract admin AND the tx source/fee account. Because
 * the admin is the source, the contract's `admin.require_auth()` is satisfied by the source-account
 * (envelope) signature — no separate `authorizeEntry` is needed. The seed is attached NON-ENUMERABLE so it
 * can't leak via logging / JSON.stringify / spread; only the derived public key is exposed. The admin
 * account must be funded with XLM (it pays its own fees).
 *
 * ⚠ TOV-141 restricts add/remove to a 2-of-3 admin multi-sig; this assumes the deployed contract admin is
 * effectively a single key = `KYC_ALLOWLIST_ADMIN_SECRET` (MVP/demo). If true 2-of-3 is enforced, submission
 * needs an out-of-band multi-signer flow (out of 03a scope) — confirm before Phase 2.
 */
export const kycAllowlistConfig = registerAs('kycAllowlist', () => {
  const adminSecret = process.env.KYC_ALLOWLIST_ADMIN_SECRET ?? '';
  const cfg = {
    rpcUrl: process.env.KYC_ALLOWLIST_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase:
      process.env.KYC_ALLOWLIST_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    // The deployed KYCAllowlist singleton (TOV-141).
    contractAddress: process.env.KYC_ALLOWLIST_CONTRACT_ADDRESS ?? '',
    // Derived pubkey — logging-safe identity + the boot-probe target (must be funded on-chain).
    adminPublicKey: adminSecret ? Keypair.fromSecret(adminSecret).publicKey() : '',
    // Per-item confirmation poll ceiling (ms). Bounds a single add/remove's wait before it is reported pending.
    submitTimeoutMs: parseInt(process.env.KYC_ALLOWLIST_SUBMIT_TIMEOUT_MS ?? '15000', 10),
    // Small synchronous batch: serialized submission is ~one ledger-close (~5-6s) per item.
    maxBatch: parseInt(process.env.KYC_ALLOWLIST_MAX_BATCH ?? '5', 10),
    probeOnBoot: (process.env.KYC_ALLOWLIST_BOOT_PROBE ?? 'true') === 'true',
  };
  // The signing seed is attached NON-ENUMERABLE so it's accessible to the signer (`cfg.adminSecret`) but
  // excluded from JSON.stringify / util.inspect / spread / Object.keys — logging/DI serialization can't leak it.
  Object.defineProperty(cfg, 'adminSecret', { value: adminSecret, enumerable: false });
  return cfg as typeof cfg & { adminSecret: string };
});
