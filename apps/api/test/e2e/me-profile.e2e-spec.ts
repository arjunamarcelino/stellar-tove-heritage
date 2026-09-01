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
import { FakeProfileStorage } from '../shared/fake-profile-storage';
import { makeJpeg } from '../shared/fixtures/images';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_PUBLIC_STORAGE,
} from '../../src/modules/users/profile/constants/profile-image.constants';

interface ChallengeResponse {
  challengeTxXdr: string;
  networkPassphrase: string;
}

const source = new FakeProfileStorage();
const pub = new FakeProfileStorage();

describe('me profile + avatar (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(PROFILE_SOURCE_STORAGE)
      .useValue(source)
      .overrideProvider(PROFILE_PUBLIC_STORAGE)
      .useValue(pub)
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
    source.clear();
    pub.clear();
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

  const auth = (token: string) => `Bearer ${token}`;

  async function pollReady(token: string, id: string): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const res = await request(server)
        .get(`/api/v1/me/profile-image/${id}`)
        .set('Authorization', auth(token));
      const status = (res.body as { status: string }).status;
      if (status === 'ready' || status === 'failed') return status;
      await new Promise((r) => setTimeout(r, 200));
    }
    return 'timeout';
  }

  it('updates + reads profile fields', async () => {
    const token = await login();
    const patch = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', auth(token))
      .send({ bio: 'Collector of textiles.', socialLinks: { twitter: 'https://x.com/me' } });
    expect(patch.status).toBe(200);

    const get = await request(server).get('/api/v1/me').set('Authorization', auth(token));
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      bio: 'Collector of textiles.',
      socialLinks: { twitter: 'https://x.com/me' },
      profileImage: null,
    });
  });

  it('rejects an over-long bio and a bad social link with 422 naming the field', async () => {
    const token = await login();
    const bio = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', auth(token))
      .send({ bio: 'a'.repeat(301) });
    expect(bio.status).toBe(422);
    expect(bio.body).toMatchObject({ errorCode: 'VALIDATION_FAILED' });
    expect((bio.body as { errors: { field: string }[] }).errors[0].field).toBe('bio');

    const link = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', auth(token))
      .send({ socialLinks: { twitter: 'not-a-url' } });
    expect(link.status).toBe(422);
    expect((link.body as { errors: { field: string }[] }).errors[0].field).toBe('socialLinks.twitter');
  });

  it('clears a field with explicit null', async () => {
    const token = await login();
    await request(server).patch('/api/v1/me').set('Authorization', auth(token)).send({ bio: 'hi' });
    await request(server).patch('/api/v1/me').set('Authorization', auth(token)).send({ bio: null });
    const get = await request(server).get('/api/v1/me').set('Authorization', auth(token));
    expect((get.body as { bio: string | null }).bio).toBeNull();
  });

  it('runs the signed-URL upload → commit → derive → activate flow and never leaks storage paths', async () => {
    const token = await login();

    const req1 = await request(server)
      .post('/api/v1/me/profile-image')
      .set('Authorization', auth(token))
      .set('Idempotency-Key', 'upload-key-1');
    expect(req1.status).toBe(201);
    const { profileImageId, upload } = req1.body as {
      profileImageId: string;
      upload: { method: string; url: string; path: string };
    };
    expect(upload.method).toBe('PUT');

    // idempotent replay → same id
    const req2 = await request(server)
      .post('/api/v1/me/profile-image')
      .set('Authorization', auth(token))
      .set('Idempotency-Key', 'upload-key-1');
    expect((req2.body as { profileImageId: string }).profileImageId).toBe(profileImageId);

    // simulate the client's direct PUT to storage
    source.putDirect(upload.path, await makeJpeg());

    const commit = await request(server)
      .post('/api/v1/me/profile-image/commit')
      .set('Authorization', auth(token))
      .set('Idempotency-Key', 'commit-key-1')
      .send({ profileImageId });
    expect(commit.status).toBe(200);
    expect((commit.body as { status: string }).status).toBe('processing');

    const status = await pollReady(token, profileImageId);
    expect(status).toBe('ready');

    const activate = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', auth(token))
      .send({ profileImageId });
    expect(activate.status).toBe(200);

    const get = await request(server).get('/api/v1/me').set('Authorization', auth(token));
    const body = get.body as { profileImage: { thumbUrl: string; cardUrl: string; heroUrl: string } | null };
    expect(body.profileImage).not.toBeNull();
    expect(body.profileImage?.heroUrl).toContain(profileImageId);
    // no storage-path leakage anywhere in the response
    expect(JSON.stringify(get.body)).not.toContain('source_path');
    expect(JSON.stringify(get.body)).not.toContain(upload.path);
  });
});
