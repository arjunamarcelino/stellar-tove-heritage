import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RELAYER_SERVICE } from '../../src/modules/relayer/relayer.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import {
  createSoftwarePasskey,
  buildAttestation,
  signAssertion,
  type SoftwarePasskey,
} from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const BUILD = '/api/v1/wallet/transfer/build';
const SUBMIT = '/api/v1/wallet/transfer/submit';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const RECIPIENT = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';

interface BeginResponse {
  options: { challenge: string };
}
interface FinishResponse {
  accessToken: string;
  contractAddress: string;
}
interface RegisteredUser extends FinishResponse {
  passkey: SoftwarePasskey;
}
interface BuildResponse {
  txXdr: string;
  challenge: string;
  credentialId: string;
  rpId: string;
  amountScaled: string;
  to: string;
}
interface SubmitResponse {
  txHash: string;
  ledger: number;
  status: string;
}
interface ErrorResponse {
  errorCode: string;
}

describe('Wallet transfer /build (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const relayer = new FakeRelayerService();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const entity of dataSource.entityMetadatas) {
      await dataSource.getRepository(entity.name).query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
    }
  });

  // Register a passkey user (begin -> finish) to mint an embedded wallet + an access token.
  async function registerUser(email: string): Promise<RegisteredUser> {
    const passkey: SoftwarePasskey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({
      passkey,
      challenge: (begin.body as BeginResponse).options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    return { ...(finish.body as FinishResponse), passkey };
  }

  async function build(accessToken: string, amount: string): Promise<BuildResponse> {
    const res = await request(server)
      .post(BUILD)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ to: RECIPIENT, amount })
      .expect(200);
    return res.body as BuildResponse;
  }

  it('builds a transfer for the authenticated owner (owner-scoped from wallet)', async () => {
    const { accessToken, contractAddress } = await registerUser('transfer-owner@example.com');

    const res = await request(server)
      .post(BUILD)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ to: RECIPIENT, amount: '10.5' })
      .expect(200);

    const body = res.body as BuildResponse;
    expect(body.amountScaled).toBe('105000000');
    expect(body.rpId).toBe(RP_ID);
    expect(body.to).toBe(RECIPIENT);
    expect(body.challenge.length).toBeGreaterThan(0);
    expect(body.credentialId.length).toBeGreaterThan(0);
    // The relayer built the transfer FROM the caller's own wallet, not a body-supplied one.
    expect(relayer.buildCalls.at(-1)?.walletContract).toBe(contractAddress);
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(server).post(BUILD).send({ to: RECIPIENT, amount: '1' }).expect(401);
  });

  it('rejects an amount over the ceiling with 400', async () => {
    const { accessToken } = await registerUser('transfer-ceiling@example.com');
    await request(server)
      .post(BUILD)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ to: RECIPIENT, amount: '200000' }) // 2e12 > 1e12 default ceiling
      .expect(400);
  });

  it('rejects a malformed recipient with 400', async () => {
    const { accessToken } = await registerUser('transfer-badto@example.com');
    await request(server)
      .post(BUILD)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ to: 'not-a-stellar-address', amount: '1' })
      .expect(400);
  });

  it('build -> sign -> submit succeeds with a valid passkey assertion', async () => {
    const { accessToken, passkey } = await registerUser('transfer-submit@example.com');
    const built = await build(accessToken, '10.5');
    const assertion = signAssertion({ passkey, challenge: built.challenge, rpId: RP_ID, origin: ORIGIN });

    const res = await request(server)
      .post(SUBMIT)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ txXdr: built.txXdr, ...assertion })
      .expect(200);

    const body = res.body as SubmitResponse;
    expect(body.status).toBe('SUCCESS');
    expect(body.txHash.length).toBeGreaterThan(0);
  });

  it('refuses submit when the signature is stripped (the Gherkin AC)', async () => {
    const { accessToken, passkey } = await registerUser('transfer-nosig@example.com');
    const built = await build(accessToken, '1');
    const assertion = signAssertion({ passkey, challenge: built.challenge, rpId: RP_ID, origin: ORIGIN });

    const res = await request(server)
      .post(SUBMIT)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ txXdr: built.txXdr, ...assertion, signature: '' })
      .expect(400); // empty signature fails DTO validation before it reaches the relayer
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses submit when the assertion signs a different challenge (binding)', async () => {
    const { accessToken, passkey } = await registerUser('transfer-badchallenge@example.com');
    const built = await build(accessToken, '1');
    // Sign a challenge that does not bind to this transfer.
    const assertion = signAssertion({
      passkey,
      challenge: Buffer.alloc(32, 9).toString('base64url'),
      rpId: RP_ID,
      origin: ORIGIN,
    });

    const res = await request(server)
      .post(SUBMIT)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ txXdr: built.txXdr, ...assertion })
      .expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('TRANSFER_SIGNATURE_INVALID');
  });
});
