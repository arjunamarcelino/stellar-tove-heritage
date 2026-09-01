import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { noOpThrottlerStorage } from '../shared/helpers';
import { truncateTables } from '../integration/setup';
import { FakeStorageService } from '../shared/fake-storage';
import { insertArtwork, insertArtworkArtist } from '../shared/seed-artwork';

const ARTIST = '00000000-0000-4000-8000-0000000e1890';
const VERIFIED = '00000000-0000-4000-8000-0000000e0001';
const FRACTIONALIZED = '00000000-0000-4000-8000-0000000e0002';
const PUBLISHED = '00000000-0000-4000-8000-0000000e0003';
const DELETED = '00000000-0000-4000-8000-0000000e0004';

type Body = Record<string, unknown>;

describe('Artworks (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider('IStorageService')
      .useValue(new FakeStorageService())
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    const q = (text: string, params?: unknown[]) => dataSource.query(text, params);
    await insertArtworkArtist(q, ARTIST);
    await insertArtwork(q, {
      id: VERIFIED,
      artistUserId: ARTIST,
      status: 'verified',
      title: 'Northern Lights',
      custodian: 'Tove Vault, Oslo',
      coaStoragePath: 'coa/aw-001.pdf',
      supportingImages: [
        { storagePath: 'img/aw-001-b.jpg', sortOrder: 1 },
        { storagePath: 'img/aw-001-a.jpg', sortOrder: 0 },
      ],
    });
    await insertArtwork(q, { id: FRACTIONALIZED, artistUserId: ARTIST, status: 'fractionalized', title: 'Midnight Sun' });
    await insertArtwork(q, { id: PUBLISHED, artistUserId: ARTIST, status: 'published', title: 'Fjord Study' });
    await insertArtwork(q, { id: DELETED, artistUserId: ARTIST, status: 'verified', title: 'Gone' });
    await q(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [DELETED]);
  });

  const get = (path: string) => request(app.getHttpServer() as object).get(path);
  // The global exception filter stamps a per-response `timestamp`; strip it so "identical body"
  // asserts the non-oracle fields (statusCode/error/message/errorCode), not the wall clock.
  const stableBody = (body: Body): Body => {
    const { timestamp: _timestamp, ...rest } = body;
    void _timestamp;
    return rest;
  };

  it('GET /artworks/:id (verified) returns 200 full detail, no-store, no cookie', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}`);
    const body = res.body as Body;

    expect(res.status).toBe(200);
    expect(body.id).toBe(VERIFIED);
    expect(body.title).toBe('Northern Lights');
    expect(body.status).toBe('verified');
    expect(body.custodian).toBe('Tove Vault, Oslo');
    // supporting images signed + ordered by sortOrder (a before b, despite seed order)
    const images = body.supportingImages as string[];
    expect(images).toHaveLength(2);
    expect(images[0]).toContain('img%2Faw-001-a.jpg');
    expect(images[1]).toContain('img%2Faw-001-b.jpg');
    expect(typeof body.coaSignedUrl).toBe('string');
    // no raw storage-path leak
    expect(body.coaStoragePath).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('GET /artworks/:id (fractionalized) returns 200', async () => {
    const res = await get(`/api/v1/artworks/${FRACTIONALIZED}`);
    expect(res.status).toBe(200);
    expect((res.body as Body).status).toBe('fractionalized');
    expect((res.body as Body).supportingImages).toEqual([]);
    expect((res.body as Body).coaSignedUrl).toBeNull();
  });

  it('GET /artworks/:id (published) returns 404 ARTWORK_NOT_FOUND', async () => {
    const res = await get(`/api/v1/artworks/${PUBLISHED}`);
    expect(res.status).toBe(404);
    expect((res.body as Body).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  it('GET /artworks/:id (soft-deleted) returns an identical 404 body', async () => {
    const published = await get(`/api/v1/artworks/${PUBLISHED}`);
    const deleted = await get(`/api/v1/artworks/${DELETED}`);
    expect(deleted.status).toBe(404);
    expect(stableBody(deleted.body as Body)).toEqual(stableBody(published.body as Body));
  });

  it('GET /artworks/:id (non-UUID) returns 404 (not 400), identical body', async () => {
    const bad = await get('/api/v1/artworks/not-a-uuid');
    const missing = await get(`/api/v1/artworks/${PUBLISHED}`);
    expect(bad.status).toBe(404);
    expect(stableBody(bad.body as Body)).toEqual(stableBody(missing.body as Body));
  });

  it('GET /artworks lists only visible statuses, cacheable, no cookie', async () => {
    const res = await get('/api/v1/artworks');
    const body = res.body as Body;
    expect(res.status).toBe(200);
    const data = body.data as Array<{ id: string; status: string }>;
    const ids = data.map((a) => a.id);
    expect(ids).toContain(VERIFIED);
    expect(ids).toContain(FRACTIONALIZED);
    expect(ids).not.toContain(PUBLISHED);
    expect(ids).not.toContain(DELETED);
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('GET /artworks/:id with a bogus bearer still returns 200 (@Public)', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}`).set('Authorization', 'Bearer bogus');
    expect(res.status).toBe(200);
  });
});
