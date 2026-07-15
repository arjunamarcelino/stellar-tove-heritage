import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { noOpThrottlerStorage } from '../shared/helpers';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

describe('App (e2e)', () => {
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

  it('GET /api/v1/health should return 200', async () => {
    const response = await request(app.getHttpServer() as object).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect((response.body as Record<string, unknown>).status).toBe('ok');
  });

  it('GET /api/v1/auth/profile without auth should return 401 AUTH_REQUIRED', async () => {
    const response = await request(app.getHttpServer() as object).get('/api/v1/auth/profile');
    expect(response.status).toBe(401);
    expect((response.body as Record<string, unknown>).errorCode).toBe('AUTH_REQUIRED');
  });

  it('GET /api/v1/auth/profile with a malformed token should return 401 AUTH_INVALID_CREDENTIALS', async () => {
    const response = await request(app.getHttpServer() as object)
      .get('/api/v1/auth/profile')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
    expect((response.body as Record<string, unknown>).errorCode).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
