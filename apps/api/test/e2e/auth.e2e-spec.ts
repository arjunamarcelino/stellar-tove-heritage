import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
}

interface ProfileResponse {
  email: string;
  currentStage: object | null;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const testUser = {
    email: 'e2e@example.com',
    password: 'StrongPass1!@#',
    firstName: 'E2E',
    lastName: 'Test',
  };

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

    dataSource = app.get(DataSource);
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  it('should register a new user and return access token + refresh token + set cookie', async () => {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    expect(response.status).toBe(201);
    expect((response.body as TokenResponse).accessToken).toBeDefined();
    expect((response.body as TokenResponse).refreshToken).toBeDefined();
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('should login and return access token + set cookie', async () => {
    await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    expect(response.status).toBe(200);
    expect((response.body as TokenResponse).accessToken).toBeDefined();
  });

  it('should access protected route with valid token', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    const { accessToken } = registerRes.body as TokenResponse;

    const profileRes = await request(server)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(profileRes.status).toBe(200);
    expect((profileRes.body as ProfileResponse).email).toBe(testUser.email);
    expect((profileRes.body as ProfileResponse).currentStage).toBeNull();
  });

  it('should refresh tokens via cookie', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    const cookies = registerRes.headers['set-cookie'] as string[];

    const refreshRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies);

    expect(refreshRes.status).toBe(200);
    expect((refreshRes.body as TokenResponse).accessToken).toBeDefined();
    expect((refreshRes.body as TokenResponse).refreshToken).toBeDefined();
  });

  it('should refresh tokens via request body', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    const { refreshToken } = registerRes.body as TokenResponse;

    const refreshRes = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect((refreshRes.body as TokenResponse).accessToken).toBeDefined();
    expect((refreshRes.body as TokenResponse).refreshToken).toBeDefined();
  });

  it('should logout and invalidate refresh token', async () => {
    const registerRes = await request(server)
      .post('/api/v1/auth/register')
      .send(testUser);

    const { accessToken } = registerRes.body as TokenResponse;
    const cookies = registerRes.headers['set-cookie'] as string[];

    const logoutRes = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(logoutRes.status).toBe(200);

    const refreshRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies);

    expect(refreshRes.status).toBe(401);
  });
});
