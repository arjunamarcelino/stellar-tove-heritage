import { describe, it, expect } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { SorobanRelayerService } from '@modules/relayer/soroban-relayer.service';
import { InMemoryRelayerAccountLock } from '@modules/relayer/in-memory-relayer-account-lock';

/** Self-contained 65-byte uncompressed secp256r1 (P-256) point — no cross-module test dependency. */
function freshP256PublicKey(): Uint8Array {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return new Uint8Array(ecdh.getPublicKey()); // 0x04 ‖ x(32) ‖ y(32)
}

/**
 * LIVE testnet verification — gated OFF in CI. Run explicitly with a funded relayer:
 *   RELAYER_LIVE_TESTNET=1 RELAYER_SECRET=S... RELAYER_FACTORY_ADDRESS=C... \
 *   RELAYER_WEBAUTHN_VERIFIER_ADDRESS=C... RELAYER_WALLET_WASM_HASH=<hex> \
 *   yarn test:integration -- testnet-deploy
 *
 * Proves the two things the mocked tests can't: (1) `deploy_wallet` succeeds on real testnet,
 * and (2) the off-chain `deriveWalletAddress` matches the real deployed address — because the
 * second call's existence check must find the wallet and self-heal to the SAME address.
 */
const LIVE = process.env.RELAYER_LIVE_TESTNET === '1';

describe.skipIf(!LIVE)('SorobanRelayerService (live testnet)', () => {
  const cfg = {
    rpcUrl: process.env.RELAYER_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase: process.env.RELAYER_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    relayerSecret: process.env.RELAYER_SECRET ?? '',
    // deploy_wallet is admin-gated: the admin secret signs the auth entry (its G-addr must == factory.admin()).
    factoryAdminSecret: process.env.RELAYER_FACTORY_ADMIN_SECRET ?? '',
    factoryAdminPublicKey: '',
    probeOnBoot: false,
    walletWasmHash: process.env.RELAYER_WALLET_WASM_HASH ?? '',
    factoryAddress: process.env.RELAYER_FACTORY_ADDRESS ?? '',
    webauthnVerifierAddress: process.env.RELAYER_WEBAUTHN_VERIFIER_ADDRESS ?? '',
    ed25519VerifierAddress: process.env.RELAYER_ED25519_VERIFIER_ADDRESS ?? '',
    deployTimeoutMs: 60000,
  };

  it(
    'deploys a real wallet, then self-heals to the SAME derived address on retry',
    async () => {
      const svc = new SorobanRelayerService(cfg, new InMemoryRelayerAccountLock());
      const secp256r1PublicKey = freshP256PublicKey();
      const credentialId = randomBytes(16).toString('base64url');

      const first = await svc.deployPasskeyWallet({ credentialId, secp256r1PublicKey });
      expect(first.contractAddress).toMatch(/^C.{55}$/);
      expect(first.txHash).not.toBe('');

      // Retry: the existence check must find it and return the SAME address (validates the
      // factory-as-deployer off-chain derivation) without a new deploy.
      const second = await svc.deployPasskeyWallet({ credentialId, secp256r1PublicKey });
      expect(second.contractAddress).toBe(first.contractAddress);
      expect(second.txHash).toBe('');
    },
    120_000,
  );
});
