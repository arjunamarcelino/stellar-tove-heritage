import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { AppModule } from '../../src/app.module';
import { Wallet } from '../../src/modules/wallets/entities/wallet.entity';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';

interface ChallengeResponse {
  challengeTxXdr: string;
  networkPassphrase: string;
}
interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
}

function decodeSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
    sub: string;
  };
  return payload.sub;
}

describe('SEP-10 wallet auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

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
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  async function requestChallenge(publicKey: string): Promise<ChallengeResponse> {
    const res = await request(server)
      .post('/api/v1/auth/sep10/challenge')
      .send({ publicKey });
    expect(res.status).toBe(200);
    return res.body as ChallengeResponse;
  }

  function sign(challenge: ChallengeResponse, kp: Keypair): string {
    const tx = TransactionBuilder.fromXDR(challenge.challengeTxXdr, challenge.networkPassphrase);
    tx.sign(kp);
    return tx.toEnvelope().toXDR('base64');
  }

  it('issues a challenge, verifies the signature, and returns tokens + cookie', async () => {
    const kp = Keypair.random();
    const challenge = await requestChallenge(kp.publicKey());
    expect(challenge.challengeTxXdr).toBeTruthy();

    const verifyRes = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge, kp) });

    expect(verifyRes.status).toBe(200);
    expect((verifyRes.body as TokenResponse).accessToken).toBeDefined();
    expect((verifyRes.body as TokenResponse).refreshToken).toBeDefined();
    expect(verifyRes.headers['set-cookie']).toBeDefined();
  });

  it('mints a wallet-only user (null email) reachable on protected routes', async () => {
    const kp = Keypair.random();
    const challenge = await requestChallenge(kp.publicKey());
    const verifyRes = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge, kp) });

    const { accessToken } = verifyRes.body as TokenResponse;
    const profileRes = await request(server)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(profileRes.status).toBe(200);
    expect((profileRes.body as { email: string | null }).email).toBeNull();

    const walletCount = await dataSource
      .getRepository(Wallet)
      .count({ where: { publicKey: kp.publicKey() } });
    expect(walletCount).toBe(1);
  });

  it('rejects a replayed (already used) challenge', async () => {
    const kp = Keypair.random();
    const challenge = await requestChallenge(kp.publicKey());
    const signed = sign(challenge, kp);

    const first = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: signed });
    expect(first.status).toBe(200);

    const replay = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: signed });
    expect(replay.status).toBe(401);
    expect((replay.body as { errorCode: string }).errorCode).toBe('AUTH_CHALLENGE_ALREADY_USED');
  });

  it('binds the same wallet to the same user across logins', async () => {
    const kp = Keypair.random();

    const c1 = await requestChallenge(kp.publicKey());
    const v1 = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(c1, kp) });

    const c2 = await requestChallenge(kp.publicKey());
    const v2 = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(c2, kp) });

    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(decodeSub((v1.body as TokenResponse).accessToken)).toBe(
      decodeSub((v2.body as TokenResponse).accessToken),
    );
  });

  it('rejects an unknown challenge with 401 AUTH_CHALLENGE_NOT_FOUND', async () => {
    // A well-formed signed challenge the server never issued.
    const kp = Keypair.random();
    const challenge = await requestChallenge(kp.publicKey());
    await truncateTables(dataSource); // drop the persisted challenge row
    const res = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge, kp) });
    expect(res.status).toBe(401);
    expect((res.body as { errorCode: string }).errorCode).toBe('AUTH_CHALLENGE_NOT_FOUND');
  });

  it('rejects a malformed public key with 400', async () => {
    const res = await request(server)
      .post('/api/v1/auth/sep10/challenge')
      .send({ publicKey: 'not-a-stellar-key' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed signed XDR with 401', async () => {
    const res = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: 'garbage-not-xdr' });
    expect(res.status).toBe(401);
    expect((res.body as { errorCode: string }).errorCode).toBe('AUTH_SIGNATURE_INVALID');
  });
});
