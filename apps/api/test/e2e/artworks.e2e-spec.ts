import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { noOpThrottlerStorage } from '../shared/helpers';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

describe('Artworks (e2e)', () => {
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

  it('GET /api/v1/artworks (anonymous) returns 200 with a data array, no cookie, cacheable', async () => {
    const response = await request(app.getHttpServer() as object).get('/api/v1/artworks');

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBe(3);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toContain('public');
  });

  it('GET /api/v1/artworks/aw-001 returns 200 with the artwork', async () => {
    const response = await request(app.getHttpServer() as object).get('/api/v1/artworks/aw-001');

    expect(response.status).toBe(200);
    expect((response.body as Record<string, unknown>).id).toBe('aw-001');
  });

  it('GET /api/v1/artworks/does-not-exist returns 404 ARTWORK_NOT_FOUND', async () => {
    const response = await request(app.getHttpServer() as object).get(
      '/api/v1/artworks/does-not-exist',
    );

    expect(response.status).toBe(404);
    expect((response.body as Record<string, unknown>).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  it('GET /api/v1/artworks with a bogus Authorization header still returns 200', async () => {
    const response = await request(app.getHttpServer() as object)
      .get('/api/v1/artworks')
      .set('Authorization', 'Bearer bogus');

    expect(response.status).toBe(200);
  });
});
