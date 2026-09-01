import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { SorobanRelayerService } from '@modules/relayer/soroban-relayer.service';
import { InMemoryRelayerAccountLock } from '@modules/relayer/in-memory-relayer-account-lock';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { decodeCoseToRawP256 } from '@modules/wallets/cose.helper';
import { createSoftwarePasskey, signAssertion } from '../../../shared/webauthn-authenticator';

/**
 * LIVE testnet verification — gated OFF in CI. Run explicitly with a funded relayer + a persistent
 * testnet deploy (factory + webauthn verifier + a USDC SAC), and a wallet that holds USDC:
 *   RELAYER_LIVE_TESTNET=1 RELAYER_SECRET=S... RELAYER_FACTORY_ADDRESS=C... \
 *   RELAYER_WEBAUTHN_VERIFIER_ADDRESS=C... RELAYER_WALLET_WASM_HASH=<hex> \
 *   RELAYER_USDC_TOKEN_ADDRESS=C... RELAYER_TEST_RP_ID=tove.io RELAYER_TEST_ORIGIN=https://tove.io \
 *   yarn test:integration -- testnet-transfer
 *
 * Proves what the mocked/fake tests can't: the OZ `AuthPayload` the backend encodes is ACCEPTED by
 * the deployed wallet's real `__check_auth` (build → device-sign → submit → SUCCESS), and that a
 * tampered assertion is refused. The happy path requires the freshly-deployed wallet to be funded
 * with USDC out-of-band (otherwise submit fails re-simulation as `simulation_failed`).
 */
const LIVE = process.env.RELAYER_LIVE_TESTNET === '1';
const RP_ID = process.env.RELAYER_TEST_RP_ID ?? 'tove.io';
const ORIGIN = process.env.RELAYER_TEST_ORIGIN ?? 'https://tove.io';

describe.skipIf(!LIVE)('SorobanRelayerService transfer (live testnet)', () => {
  const cfg = {
    rpcUrl: process.env.RELAYER_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase: process.env.RELAYER_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    relayerSecret: process.env.RELAYER_SECRET ?? '',
    // Not used by the transfer path; fall back to the relayer seed so the constructor's admin keypair
    // derivation doesn't throw on a transfer-only live run.
    factoryAdminSecret: process.env.RELAYER_FACTORY_ADMIN_SECRET ?? process.env.RELAYER_SECRET ?? '',
    factoryAdminPublicKey: '',
    probeOnBoot: false,
    walletWasmHash: process.env.RELAYER_WALLET_WASM_HASH ?? '',
    factoryAddress: process.env.RELAYER_FACTORY_ADDRESS ?? '',
    webauthnVerifierAddress: process.env.RELAYER_WEBAUTHN_VERIFIER_ADDRESS ?? '',
    ed25519VerifierAddress: process.env.RELAYER_ED25519_VERIFIER_ADDRESS ?? '',
    deployTimeoutMs: 60000,
    usdcTokenAddress: process.env.RELAYER_USDC_TOKEN_ADDRESS ?? '',
    submitTimeoutMs: 60000,
    maxTxFeeStroops: 10000000,
    maxTransferAmount: '1000000000000',
  };

  // Deploy a wallet bound to a software passkey we control, then drive build → sign → submit.
  async function deployWallet() {
    const svc = new SorobanRelayerService(cfg, new InMemoryRelayerAccountLock());
    const passkey = createSoftwarePasskey();
    const boundPublicKey = decodeCoseToRawP256(passkey.cosePublicKey);
    const credentialId = Buffer.from(passkey.credentialId).toString('base64url');
    const deployed = await svc.deployPasskeyWallet({ credentialId, secp256r1PublicKey: boundPublicKey });
    return { svc, passkey, boundPublicKey, credentialId, wallet: deployed.contractAddress };
  }

  it(
    'build → sign → submit is accepted by the deployed wallet (requires a USDC-funded wallet)',
    async () => {
      const { svc, passkey, boundPublicKey, credentialId, wallet } = await deployWallet();
      const to = Keypair.random().publicKey();

      const built = await svc.buildTransfer({
        walletContract: wallet,
        tokenContract: cfg.usdcTokenAddress,
        to,
        amountScaled: '1', // 1 stroop of USDC (7dp)
      });
      const assertion = signAssertion({ passkey, challenge: built.challenge, rpId: RP_ID, origin: ORIGIN });

      const result = await svc.submitSignedTransfer({
        txXdr: built.txXdr,
        walletContract: wallet,
        tokenContract: cfg.usdcTokenAddress,
        boundPublicKey,
        credentialId,
        authenticatorData: Buffer.from(assertion.authenticatorData, 'base64url'),
        clientDataJSON: Buffer.from(assertion.clientDataJSON, 'base64url'),
        signature: Buffer.from(assertion.signature, 'base64url'),
        rpId: RP_ID,
        allowedOrigins: [ORIGIN],
        maxTransferAmount: cfg.maxTransferAmount,
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
    },
    180_000,
  );

  it(
    'refuses a tampered assertion (signs a different challenge)',
    async () => {
      const { svc, passkey, boundPublicKey, credentialId, wallet } = await deployWallet();
      const built = await svc.buildTransfer({
        walletContract: wallet,
        tokenContract: cfg.usdcTokenAddress,
        to: Keypair.random().publicKey(),
        amountScaled: '1',
      });
      // Sign a challenge that does not bind to this transfer.
      const assertion = signAssertion({
        passkey,
        challenge: randomBytes(32).toString('base64url'),
        rpId: RP_ID,
        origin: ORIGIN,
      });

      await expect(
        svc.submitSignedTransfer({
          txXdr: built.txXdr,
          walletContract: wallet,
          tokenContract: cfg.usdcTokenAddress,
          boundPublicKey,
          credentialId,
          authenticatorData: Buffer.from(assertion.authenticatorData, 'base64url'),
          clientDataJSON: Buffer.from(assertion.clientDataJSON, 'base64url'),
          signature: Buffer.from(assertion.signature, 'base64url'),
          rpId: RP_ID,
          allowedOrigins: [ORIGIN],
          maxTransferAmount: cfg.maxTransferAmount,
        }),
      ).rejects.toBeInstanceOf(RelayerTransferError);
    },
    180_000,
  );
});
