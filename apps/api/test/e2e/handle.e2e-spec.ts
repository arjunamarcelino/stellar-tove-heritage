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

describe('handle (e2e)', () => {
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

  /** Authenticate a fresh Collector via SEP-10 login; returns the access token. */
  async function login(): Promise<string> {
    const kp = Keypair.random();
    const challenge = await request(server).post('/api/v1/auth/sep10/challenge').send({ publicKey: kp.publicKey() });
    const verify = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge.body as ChallengeResponse, kp) });
    return (verify.body as { accessToken: string }).accessToken;
  }

  const setHandle = (token: string, handle: unknown) =>
    request(server).post('/api/v1/me/handle').set('Authorization', `Bearer ${token}`).send({ handle });
  const getHandle = (token: string) =>
    request(server).get('/api/v1/me/handle').set('Authorization', `Bearer ${token}`);
  const check = (handle?: string) =>
    request(server).get('/api/v1/handles/check').query(handle === undefined ? {} : { handle });

  describe('POST /me/handle', () => {
    it('sets a handle → 200 { handle, handleCanonical }', async () => {
      const token = await login();
      const res = await setHandle(token, 'Maya');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handle: 'Maya', handleCanonical: 'maya' });
    });

    it('rejects a case-insensitive duplicate from another collector → 409 HANDLE_TAKEN (AC1)', async () => {
      const a = await login();
      const b = await login();
      expect((await setHandle(a, 'Maya')).status).toBe(200);
      const res = await setHandle(b, 'MAYA');
      expect(res.status).toBe(409);
      expect((res.body as { errorCode: string }).errorCode).toBe('HANDLE_TAKEN');
    });

    it('rejects invalid format (space / @) → 422 HANDLE_FORMAT_INVALID (AC3)', async () => {
      const token = await login();
      for (const bad of ['ma ya', 'ma@ya']) {
        const res = await setHandle(token, bad);
        expect(res.status, bad).toBe(422);
        expect((res.body as { errorCode: string }).errorCode).toBe('HANDLE_FORMAT_INVALID');
      }
    });

    it('rejects a reserved word → 422 HANDLE_RESERVED (AC4, AC13 casing)', async () => {
      const token = await login();
      for (const w of ['admin', 'ADMIN', '  admin  ']) {
        const res = await setHandle(token, w);
        expect(res.status, w).toBe(422);
        expect((res.body as { errorCode: string }).errorCode).toBe('HANDLE_RESERVED');
      }
    });

    it('precedence: reserved + illegal char → 422 HANDLE_FORMAT_INVALID (AC7)', async () => {
      const token = await login();
      const res = await setHandle(token, 'Admin!');
      expect(res.status).toBe(422);
      expect((res.body as { errorCode: string }).errorCode).toBe('HANDLE_FORMAT_INVALID');
    });

    it('empty string → 422 format; missing/non-string handle → 400 (AC8)', async () => {
      const token = await login();
      expect((await setHandle(token, '')).status).toBe(422);
      expect((await setHandle(token, 123)).status).toBe(400);
      const noBody = await request(server).post('/api/v1/me/handle').set('Authorization', `Bearer ${token}`).send({});
      expect(noBody.status).toBe(400);
    });

    it('trims surrounding whitespace then accepts → 200 stored trimmed (AC11)', async () => {
      const token = await login();
      const res = await setHandle(token, '  maya  ');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handle: 'maya', handleCanonical: 'maya' });
    });

    it('freely changeable + releases the old handle for others', async () => {
      const a = await login();
      const b = await login();
      expect((await setHandle(a, 'first')).status).toBe(200);
      expect((await setHandle(a, 'second')).status).toBe(200); // change
      expect((await setHandle(b, 'first')).status).toBe(200); // old handle now free
    });

    it('requires authentication → 401', async () => {
      const res = await request(server).post('/api/v1/me/handle').send({ handle: 'maya' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /me/handle (AC6 read-back)', () => {
    it('returns null before, the handle after', async () => {
      const token = await login();
      expect((await getHandle(token)).body).toEqual({ handle: null });
      await setHandle(token, 'Maya');
      expect((await getHandle(token)).body).toEqual({ handle: 'Maya' });
    });

    it('requires authentication → 401', async () => {
      expect((await request(server).get('/api/v1/me/handle')).status).toBe(401);
    });
  });

  describe('GET /handles/check (public)', () => {
    it('available:true for a free handle', async () => {
      const res = await check('freehandle');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handle: 'freehandle', available: true });
    });

    it('taken (case-insensitive) → available:false reason:taken (AC14)', async () => {
      const token = await login();
      await setHandle(token, 'Maya');
      const res = await check('MAYA');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ handle: 'MAYA', available: false, reason: 'taken' });
    });

    it('reserved → available:false reason:reserved', async () => {
      const res = await check('admin');
      expect(res.body).toEqual({ handle: 'admin', available: false, reason: 'reserved' });
    });

    it('missing param → 400; empty value → 200 invalid_format (AC12)', async () => {
      expect((await check(undefined)).status).toBe(400);
      const empty = await check('');
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ handle: '', available: false, reason: 'invalid_format' });
    });

    it('is public (no auth required)', async () => {
      expect((await check('anything')).status).toBe(200);
    });
  });
});
