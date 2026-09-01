import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
}

interface AdminResponse {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  createdAt: string;
}

interface PaginatedAdminResponse {
  data: AdminResponse[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('Backoffice Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const superadminEmail = 'superadmin@example.com';
  const superadminPassword = 'SuperAdmin1!@#';

  async function seedSuperadmin(): Promise<void> {
    const passwordHash = await bcrypt.hash(superadminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id", "email", "password_hash", "role", "is_active", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'superadmin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [superadminEmail, passwordHash],
    );
  }

  async function loginSuperadmin(): Promise<string> {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: superadminEmail, password: superadminPassword });
    return (res.body as TokenResponse).accessToken;
  }

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

  describe('POST /backoffice/auth/login', () => {
    it('should login superadmin and return tokens + set cookie', async () => {
      await seedSuperadmin();

      const response = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: superadminEmail, password: superadminPassword });

      expect(response.status).toBe(200);
      expect((response.body as TokenResponse).accessToken).toBeDefined();
      expect((response.body as TokenResponse).refreshToken).toBeDefined();
      expect(response.headers['set-cookie']).toBeDefined();
      const cookies = response.headers['set-cookie'] as string[];
      expect(cookies.some((c: string) => c.startsWith('bo_refresh_token='))).toBe(true);
    });

    it('should return 401 for wrong password', async () => {
      await seedSuperadmin();

      const response = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: superadminEmail, password: 'WrongPass1!@#' });

      expect(response.status).toBe(401);
    });

    it('should return 401 for non-existent email', async () => {
      const response = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'SomePass1!@#' });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /backoffice/auth/register', () => {
    it('should require superadmin token', async () => {
      const response = await request(server)
        .post('/api/backoffice/v1/auth/register')
        .send({
          email: 'new@example.com',
          password: 'StrongPass1!@#',
        });

      expect(response.status).toBe(401);
    });

    it('should create new admin when authenticated as superadmin', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const response = await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'newadmin@example.com',
          password: 'StrongPass1!@#',
          firstName: 'New',
          lastName: 'Admin',
        });

      expect(response.status).toBe(201);
      expect((response.body as AdminResponse).email).toBe('newadmin@example.com');
      expect((response.body as AdminResponse).role).toBe('admin');
    });

    it('should reject duplicate email', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'dup@example.com',
          password: 'StrongPass1!@#',
        });

      const response = await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'dup@example.com',
          password: 'StrongPass1!@#',
        });

      expect(response.status).toBe(409);
    });
  });

  describe('POST /backoffice/auth/refresh', () => {
    it('should refresh tokens via request body', async () => {
      await seedSuperadmin();
      const loginRes = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: superadminEmail, password: superadminPassword });

      const { refreshToken } = loginRes.body as TokenResponse;

      const response = await request(server)
        .post('/api/backoffice/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect((response.body as TokenResponse).accessToken).toBeDefined();
      expect((response.body as TokenResponse).refreshToken).toBeDefined();
    });

    it('should refresh tokens via cookie', async () => {
      await seedSuperadmin();
      const loginRes = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: superadminEmail, password: superadminPassword });

      const cookies = loginRes.headers['set-cookie'] as string[];

      const response = await request(server)
        .post('/api/backoffice/v1/auth/refresh')
        .set('Cookie', cookies);

      expect(response.status).toBe(200);
      expect((response.body as TokenResponse).accessToken).toBeDefined();
    });

    it('should return 401 with no refresh token', async () => {
      const response = await request(server)
        .post('/api/backoffice/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('POST /backoffice/auth/logout', () => {
    it('should logout and invalidate refresh token', async () => {
      await seedSuperadmin();
      const loginRes = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: superadminEmail, password: superadminPassword });

      const { accessToken, refreshToken } = loginRes.body as TokenResponse;

      const logoutRes = await request(server)
        .post('/api/backoffice/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(logoutRes.status).toBe(200);

      // Refresh should now fail
      const refreshRes = await request(server)
        .post('/api/backoffice/v1/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });

  describe('GET /backoffice/auth/profile', () => {
    it('should return admin profile', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/auth/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect((response.body as AdminResponse).email).toBe(superadminEmail);
      expect((response.body as AdminResponse).role).toBe('superadmin');
    });

    it('should return 401 without token', async () => {
      const response = await request(server)
        .get('/api/backoffice/v1/auth/profile');

      expect(response.status).toBe(401);
    });
  });

  describe('Admins CRUD', () => {
    it('GET /backoffice/admins should return paginated list', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/admins')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect((response.body as PaginatedAdminResponse).data).toHaveLength(1);
      expect((response.body as PaginatedAdminResponse).meta.total).toBe(1);
    });

    it('GET /backoffice/admins/:id should return admin by id', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const listRes = await request(server)
        .get('/api/backoffice/v1/admins')
        .set('Authorization', `Bearer ${token}`);

      const adminId = (listRes.body as PaginatedAdminResponse).data[0].id;

      const response = await request(server)
        .get(`/api/backoffice/v1/admins/${adminId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect((response.body as AdminResponse).id).toBe(adminId);
    });

    it('PATCH /backoffice/admins/:id should update admin', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      // Create a regular admin to update
      await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'updatable@example.com',
          password: 'StrongPass1!@#',
          firstName: 'Before',
        });

      const listRes = await request(server)
        .get('/api/backoffice/v1/admins')
        .set('Authorization', `Bearer ${token}`);

      const admin = (listRes.body as PaginatedAdminResponse).data.find(
        (a) => a.email === 'updatable@example.com',
      )!;

      const response = await request(server)
        .patch(`/api/backoffice/v1/admins/${admin.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'After' });

      expect(response.status).toBe(200);
      expect((response.body as AdminResponse).firstName).toBe('After');
    });

    it('DELETE /backoffice/admins/:id should soft-delete admin', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      // Create an admin to delete
      const createRes = await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'deletable@example.com',
          password: 'StrongPass1!@#',
        });

      const adminId = (createRes.body as AdminResponse).id;

      const response = await request(server)
        .delete(`/api/backoffice/v1/admins/${adminId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(204);

      // Verify not in list anymore
      const listRes = await request(server)
        .get('/api/backoffice/v1/admins')
        .set('Authorization', `Bearer ${token}`);

      const deleted = (listRes.body as PaginatedAdminResponse).data.find(
        (a) => a.id === adminId,
      );
      expect(deleted).toBeUndefined();
    });

    it('should reject admin CRUD without superadmin token', async () => {
      await seedSuperadmin();
      const superadminToken = await loginSuperadmin();

      // Create a regular admin
      await request(server)
        .post('/api/backoffice/v1/auth/register')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          email: 'regular@example.com',
          password: 'StrongPass1!@#',
        });

      // Login as regular admin
      const loginRes = await request(server)
        .post('/api/backoffice/v1/auth/login')
        .send({ email: 'regular@example.com', password: 'StrongPass1!@#' });

      const regularToken = (loginRes.body as TokenResponse).accessToken;

      // Try to list admins
      const response = await request(server)
        .get('/api/backoffice/v1/admins')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(response.status).toBe(403);
    });
  });
});
