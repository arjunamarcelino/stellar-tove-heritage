import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { noOpThrottlerStorage } from '../shared/helpers';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

describe('Artists (e2e)', () => {
  let app: INestApplication;

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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/artists returns 200 with a data array and no Set-Cookie', async () => {
    const res = await request(app.getHttpServer() as object).get('/api/v1/artists');
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
    expect((res.body as { data: unknown[] }).data).toHaveLength(2);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('public');
  });

  it('GET /api/v1/artists/sophie-tove returns 200 with the artist', async () => {
    const res = await request(app.getHttpServer() as object).get('/api/v1/artists/sophie-tove');
    expect(res.status).toBe(200);
    expect((res.body as { handle: string }).handle).toBe('sophie-tove');
  });

  it('GET /api/v1/artists/unknown-handle returns 404 ARTIST_NOT_FOUND', async () => {
    const res = await request(app.getHttpServer() as object).get('/api/v1/artists/unknown-handle');
    expect(res.status).toBe(404);
    expect((res.body as { errorCode: string }).errorCode).toBe('ARTIST_NOT_FOUND');
  });

  it('GET /api/v1/artists/Bad%20Handle returns 404 ARTIST_NOT_FOUND (not 500)', async () => {
    const res = await request(app.getHttpServer() as object).get('/api/v1/artists/Bad%20Handle');
    expect(res.status).toBe(404);
    expect((res.body as { errorCode: string }).errorCode).toBe('ARTIST_NOT_FOUND');
  });
});
