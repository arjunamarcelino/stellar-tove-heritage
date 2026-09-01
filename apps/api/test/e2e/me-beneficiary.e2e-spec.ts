import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';

interface ChallengeResponse {
  challengeTxXdr: string;
  networkPassphrase: string;
}
interface Beneficiary {
  id: string;
  name: string;
  email: string;
  stellarPubkey: string | null;
  relationship: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
interface BeneficiaryResponse {
  beneficiary: Beneficiary | null;
  notice: { code: string; message: string } | null;
}

describe('me/beneficiary (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  function sign(challenge: ChallengeResponse, kp: Keypair): string {
    const tx = TransactionBuilder.fromXDR(challenge.challengeTxXdr, challenge.networkPassphrase);
    tx.sign(kp);
    return tx.toEnvelope().toXDR('base64');
  }

  /** Authenticate a fresh Collector via SEP-10 login; returns the access token + login keypair. */
  async function login(): Promise<{ token: string; kp: Keypair }> {
    const kp = Keypair.random();
    const challenge = await request(server).post('/api/v1/auth/sep10/challenge').send({ publicKey: kp.publicKey() });
    const verify = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge.body as ChallengeResponse, kp) });
    return { token: (verify.body as { accessToken: string }).accessToken, kp };
  }

  const auth = (token: string) => `Bearer ${token}`;

  function getBeneficiary(token: string) {
    return request(server).get('/api/v1/me/beneficiary').set('Authorization', auth(token));
  }
  function setBeneficiary(token: string, body: Record<string, unknown>) {
    return request(server).post('/api/v1/me/beneficiary').set('Authorization', auth(token)).send(body);
  }
  function deleteBeneficiary(token: string) {
    return request(server).delete('/api/v1/me/beneficiary').set('Authorization', auth(token));
  }

  it('sets a beneficiary (200 + KYC notice) and reads it back', async () => {
    const { token } = await login(); // fresh SEP-10 user → kyc_status not_submitted → notice shown
    const stellarPubkey = Keypair.random().publicKey();

    const post = await setBeneficiary(token, { name: 'Jane Doe', email: 'jane@example.com', stellarPubkey });
    expect(post.status).toBe(200);
    const posted = post.body as BeneficiaryResponse;
    expect(posted.beneficiary).not.toBeNull();
    expect(posted.beneficiary).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      stellarPubkey,
    });
    expect(posted.notice?.code).toBe('KYC_REQUIRED_FOR_TRANSFER');

    const get = await getBeneficiary(token);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ beneficiary: { name: 'Jane Doe', email: 'jane@example.com' } });
  });

  it('full-replaces: omitting an optional field clears it while keeping the same id', async () => {
    const { token } = await login();
    const first = await setBeneficiary(token, {
      name: 'Jane Doe',
      email: 'jane@example.com',
      stellarPubkey: Keypair.random().publicKey(),
    });
    expect(first.status).toBe(200);
    const firstId = (first.body as BeneficiaryResponse).beneficiary?.id;
    expect(firstId).toBeTruthy();

    // Re-POST without stellarPubkey → the omitted optional is cleared to null.
    const second = await setBeneficiary(token, { name: 'John Roe', email: 'jane@example.com' });
    expect(second.status).toBe(200);

    const get = await getBeneficiary(token);
    const body = get.body as BeneficiaryResponse;
    expect(body.beneficiary?.name).toBe('John Roe');
    expect(body.beneficiary?.stellarPubkey).toBeNull();
    expect(body.beneficiary?.id).toBe(firstId); // full-replace upsert keeps the row identity
  });

  it('deletes the beneficiary (200 null) and is idempotent', async () => {
    const { token } = await login();
    await setBeneficiary(token, { name: 'Jane Doe', email: 'jane@example.com' });

    const del = await deleteBeneficiary(token);
    expect(del.status).toBe(200);
    expect((del.body as BeneficiaryResponse).beneficiary).toBeNull();

    const get = await getBeneficiary(token);
    expect(get.status).toBe(200);
    expect((get.body as BeneficiaryResponse).beneficiary).toBeNull();

    // Second delete is a no-op idempotent 200.
    const delAgain = await deleteBeneficiary(token);
    expect(delAgain.status).toBe(200);
    expect((delAgain.body as BeneficiaryResponse).beneficiary).toBeNull();
  });

  it('rejects an invalid body (missing name / bad email) with 400', async () => {
    const { token } = await login();
    const res = await setBeneficiary(token, { email: 'nope' });
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated access (401)', async () => {
    expect((await request(server).get('/api/v1/me/beneficiary')).status).toBe(401);
  });
});
