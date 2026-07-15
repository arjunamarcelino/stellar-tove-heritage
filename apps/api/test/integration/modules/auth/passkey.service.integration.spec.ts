import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AuthModule } from '@modules/auth/auth.module';
import { PasskeyService } from '@modules/auth/passkey.service';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { PasskeyCredential } from '@modules/wallets/entities/passkey-credential.entity';
import { RELAYER_SERVICE } from '@modules/relayer/relayer.service.interface';
import { createTestingModuleBuilder, truncateTables } from '../../setup';
import { FakeRelayerService } from '../../../shared/fake-relayer';
import {
  createSoftwarePasskey,
  buildAttestation,
  type SoftwarePasskey,
} from '../../../shared/webauthn-authenticator';

const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';

describe('PasskeyService (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: PasskeyService;
  let relayer: FakeRelayerService;

  beforeAll(async () => {
    relayer = new FakeRelayerService();
    moduleRef = await createTestingModuleBuilder(AuthModule)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .compile();
    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(PasskeyService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  // Run begin -> build a matching attestation for `passkey`.
  async function begin(email: string, passkey: SoftwarePasskey) {
    const { options } = await service.begin(email);
    return buildAttestation({ passkey, challenge: options.challenge, rpId: RP_ID, origin: ORIGIN });
  }

  const walletRepo = () => dataSource.getRepository(Wallet);
  const credRepo = () => dataSource.getRepository(PasskeyCredential);

  it('registers: verifies, deploys, and creates user + wallet + credential atomically', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('collector@example.com', passkey);

    const tokens = await service.finish({ email: 'collector@example.com', attestationResponse });

    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const wallets = await walletRepo().find({ relations: { user: true } });
    expect(wallets).toHaveLength(1);
    expect(wallets[0].kind).toBe('embedded_passkey');
    expect(wallets[0].contractAddress).toBeTruthy();
    expect(wallets[0].publicKey).toBeNull();
    expect(wallets[0].user.email).toBe('collector@example.com');
    // finish returns the deployed wallet address, matching the persisted row.
    expect(tokens.contractAddress).toBe(wallets[0].contractAddress);

    const creds = await credRepo().find();
    expect(creds).toHaveLength(1);
    expect(creds[0].walletId).toBe(wallets[0].id);
  });

  it('deploy failure leaves zero rows + a live challenge; retry then succeeds', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('retry@example.com', passkey);

    relayer.failNext();
    await expect(
      service.finish({ email: 'retry@example.com', attestationResponse }),
    ).rejects.toMatchObject({ response: { errorCode: 'WALLET_DEPLOY_FAILED' } });

    expect(await walletRepo().count()).toBe(0);
    expect(await credRepo().count()).toBe(0);

    // Same attestation retried (challenge still live) now succeeds.
    const tokens = await service.finish({ email: 'retry@example.com', attestationResponse });
    expect(tokens.accessToken).toBeTruthy();
    expect(await walletRepo().count()).toBe(1);
  });

  it('rejects a duplicate credential bound to a different email (PASSKEY_ALREADY_BOUND)', async () => {
    const passkey = createSoftwarePasskey();
    const first = await begin('first@example.com', passkey);
    await service.finish({ email: 'first@example.com', attestationResponse: first });

    // Reuse the SAME passkey (credentialId) for a different email.
    const second = await begin('second@example.com', passkey);
    await expect(
      service.finish({ email: 'second@example.com', attestationResponse: second }),
    ).rejects.toMatchObject({ response: { errorCode: 'PASSKEY_ALREADY_BOUND' } });

    expect(await walletRepo().count()).toBe(1);
  });

  it('idempotent replay: re-submitting a completed registration re-issues tokens', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('replay@example.com', passkey);
    const first = await service.finish({ email: 'replay@example.com', attestationResponse });
    const again = await service.finish({ email: 'replay@example.com', attestationResponse });

    expect(again.accessToken).toBeTruthy();
    expect(first.accessToken).toBeTruthy();
    // still exactly one wallet + credential
    expect(await walletRepo().count()).toBe(1);
    expect(await credRepo().count()).toBe(1);
  });

  it('reusing a consumed challenge with a different passkey -> AUTH_CHALLENGE_ALREADY_USED', async () => {
    const passkey1 = createSoftwarePasskey();
    const { options } = await service.begin('used@example.com');
    const att1 = buildAttestation({ passkey: passkey1, challenge: options.challenge, rpId: RP_ID, origin: ORIGIN });
    await service.finish({ email: 'used@example.com', attestationResponse: att1 });

    // A different authenticator re-embeds the same (now consumed) challenge.
    const passkey2 = createSoftwarePasskey();
    const att2 = buildAttestation({ passkey: passkey2, challenge: options.challenge, rpId: RP_ID, origin: ORIGIN });
    await expect(
      service.finish({ email: 'used@example.com', attestationResponse: att2 }),
    ).rejects.toMatchObject({ response: { errorCode: 'AUTH_CHALLENGE_ALREADY_USED' } });
  });

  it('rejects registration for an email already taken by an email/password user', async () => {
    // Seed an email/password user, then try passkey begin with the same email.
    await dataSource.query(
      `INSERT INTO users (email, password_hash, is_active) VALUES ($1, $2, true)`,
      ['dupe@example.com', '$2b$12$abcdefghijklmnopqrstuv'],
    );
    await expect(service.begin('dupe@example.com')).rejects.toMatchObject({
      response: { errorCode: 'AUTH_EMAIL_CONFLICT' },
    });
  });
});
