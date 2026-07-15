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

interface ProfileBody {
  handle: string;
  previousHandles: string[];
  createdAt: string;
}

/** Drop the exception filter's `timestamp` (response time — not an existence oracle) before comparing bodies. */
function stripTimestamp(body: unknown): Record<string, unknown> {
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.timestamp;
  return rest;
}

describe('collectors (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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

  async function login(): Promise<string> {
    const kp = Keypair.random();
    const challenge = await request(server).post('/api/v1/auth/sep10/challenge').send({ publicKey: kp.publicKey() });
    const verify = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge.body as ChallengeResponse, kp) });
    return (verify.body as { accessToken: string }).accessToken;
  }

  const setHandle = (token: string, handle: string) =>
    request(server).post('/api/v1/me/handle').set('Authorization', `Bearer ${token}`).send({ handle });
  const getCollector = (handle: string) => request(server).get(`/api/v1/collectors/${handle}`);
  const setVisibility = (token: string, isPublic: boolean) =>
    request(server).patch('/api/v1/me/handle/history').set('Authorization', `Bearer ${token}`).send({ public: isPublic });

  it('surfaces the previous handle after a change; old handle 404s (AC1)', async () => {
    const token = await login();
    await setHandle(token, 'earlyname');
    await setHandle(token, 'newname');

    const res = await getCollector('newname');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      handle: 'newname',
      previousHandles: ['earlyname'],
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown, // member-since date only
    });

    expect((await getCollector('earlyname')).status).toBe(404); // old handle is not an alias
  });

  it('returns 3 previous handles newest-first (AC2)', async () => {
    const token = await login();
    for (const h of ['name1', 'name2', 'name3', 'current']) await setHandle(token, h);
    const res = await getCollector('current');
    expect((res.body as ProfileBody).previousHandles).toEqual(['name3', 'name2', 'name1']);
  });

  it('first-ever handle has an empty previous list, with a createdAt (AC3)', async () => {
    const token = await login();
    await setHandle(token, 'solo');
    const res = await getCollector('solo');
    expect((res.body as ProfileBody).previousHandles).toEqual([]);
    expect(typeof (res.body as ProfileBody).createdAt).toBe('string');
  });

  it('dedups a repeated handle: alice→bob→alice→carol ⇒ [alice, bob] (AC4/AC5)', async () => {
    const token = await login();
    for (const h of ['alice', 'bob', 'alice', 'carol']) await setHandle(token, h);
    expect(((await getCollector('carol')).body as ProfileBody).previousHandles).toEqual(['alice', 'bob']);
  });

  it('resolves the current handle case-insensitively (AC6)', async () => {
    const token = await login();
    await setHandle(token, 'MixedCase');
    const res = await getCollector('mixedcase');
    expect(res.status).toBe(200);
    expect((res.body as ProfileBody).handle).toBe('MixedCase');
  });

  it('unknown, old, and over-length handles all return an identical 404 body — no existence oracle (AC14)', async () => {
    const token = await login();
    await setHandle(token, 'wasthis');
    await setHandle(token, 'nowthis'); // 'wasthis' is now an old handle

    const unknown = await getCollector('neverexisted');
    const old = await getCollector('wasthis');
    const tooLong = await getCollector('x'.repeat(40));

    expect(unknown.status).toBe(404);
    expect(old.status).toBe(404);
    expect(tooLong.status).toBe(404);
    expect((unknown.body as { errorCode: string }).errorCode).toBe('COLLECTOR_NOT_FOUND');
    // Identical modulo the filter's `timestamp`: old is indistinguishable from never-existed / over-length.
    expect(stripTimestamp(old.body)).toEqual(stripTimestamp(unknown.body));
    expect(stripTimestamp(tooLong.body)).toEqual(stripTimestamp(unknown.body));
  });

  it('is public (no auth) and leaks no PII fields (AC11)', async () => {
    const token = await login();
    await setHandle(token, 'pseudonym');
    const res = await getCollector('pseudonym'); // no Authorization header
    expect(res.status).toBe(200);
    expect(Object.keys(res.body as ProfileBody).sort()).toEqual(['createdAt', 'handle', 'previousHandles']);
  });

  describe('history visibility opt-out (AC12)', () => {
    it('PATCH /me/handle/history {public:false} hides previous handles; re-enabling restores them', async () => {
      const token = await login();
      await setHandle(token, 'old');
      await setHandle(token, 'new');

      const off = await setVisibility(token, false);
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ public: false });
      expect(((await getCollector('new')).body as ProfileBody).previousHandles).toEqual([]);

      await setVisibility(token, true);
      expect(((await getCollector('new')).body as ProfileBody).previousHandles).toEqual(['old']);
    });

    it('requires authentication → 401', async () => {
      const res = await request(server).patch('/api/v1/me/handle/history').send({ public: false });
      expect(res.status).toBe(401);
    });
  });
});
