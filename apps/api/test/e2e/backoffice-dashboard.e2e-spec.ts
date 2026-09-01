import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';

interface TokenResponse {
  accessToken: string;
}

interface SummaryResponse {
  totalUsers: number;
  totalMissions: number;
  activeMissions: number;
}

interface MissionStatsResponse {
  missionId: string;
  missionTitle: string;
  stageTitle: string;
  totalUsers: number;
  pending: number;
  accepted: number;
  rejected: number;
}

describe('Backoffice Dashboard (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const superadminEmail = 'dashboard-admin@example.com';
  const superadminPassword = 'SuperAdmin1!@#';
  const platformUserEmail = 'user@example.com';
  const platformUserPassword = 'UserPass1!@#';

  async function seedSuperadmin(): Promise<void> {
    const passwordHash = await bcrypt.hash(superadminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id", "email", "password_hash", "role", "is_active", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'superadmin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [superadminEmail, passwordHash],
    );
  }

  async function seedAdmin(): Promise<void> {
    const passwordHash = await bcrypt.hash(superadminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id", "email", "password_hash", "role", "is_active", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'admin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      ['admin@example.com', passwordHash],
    );
  }

  async function loginSuperadmin(): Promise<string> {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: superadminEmail, password: superadminPassword });
    return (res.body as TokenResponse).accessToken;
  }

  async function loginAdmin(): Promise<string> {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: 'admin@example.com', password: superadminPassword });
    return (res.body as TokenResponse).accessToken;
  }

  async function loginPlatformUser(): Promise<string> {
    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: platformUserEmail,
        password: platformUserPassword,
        firstName: 'Test',
        lastName: 'User',
      });
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: platformUserEmail, password: platformUserPassword });
    return (res.body as TokenResponse).accessToken;
  }

  async function seedTestData(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "users" ("id", "email", "password_hash", "is_active", "created_at", "updated_at")
       VALUES
         (gen_random_uuid(), 'user1@test.com', '$2b$12$LJ3m4ks9Yz5U5zBqVO9ixeNlGn9PbEoPMqN0FEBqU3x0f.qHbVxYm', true, now(), now()),
         (gen_random_uuid(), 'user2@test.com', '$2b$12$LJ3m4ks9Yz5U5zBqVO9ixeNlGn9PbEoPMqN0FEBqU3x0f.qHbVxYm', true, now(), now())`,
    );

    const stageResult: { id: string }[] = await dataSource.query(
      `INSERT INTO "stages" ("id", "title", "order", "is_active", "created_by", "created_at", "updated_at")
       VALUES (gen_random_uuid(), 'Stage 1: Social', 1, true, (SELECT id FROM admins LIMIT 1), now(), now())
       RETURNING id`,
    );
    const stageId = stageResult[0].id;

    const missionResult: { id: string }[] = await dataSource.query(
      `INSERT INTO "missions" ("id", "stage_id", "title", "order", "evidence_type", "is_active", "created_by", "created_at", "updated_at")
       VALUES
         (gen_random_uuid(), $1, 'Follow @tove on Instagram', 1, 'file', true, (SELECT id FROM admins LIMIT 1), now(), now()),
         (gen_random_uuid(), $1, 'Inactive Mission', 2, 'file', false, (SELECT id FROM admins LIMIT 1), now(), now())
       RETURNING id`,
      [stageId],
    );
    const activeMissionId = missionResult[0].id;

    const userIds: { id: string }[] = await dataSource.query(
      `SELECT id FROM users ORDER BY email`,
    );
    const user1Id = userIds[0].id;
    const user2Id = userIds[1].id;

    await dataSource.query(
      `INSERT INTO "submissions" ("id", "user_id", "mission_id", "status", "created_at", "updated_at")
       VALUES
         (gen_random_uuid(), $1, $3, 'pending', now(), now()),
         (gen_random_uuid(), $2, $3, 'accepted', now(), now())`,
      [user1Id, user2Id, activeMissionId],
    );
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

  describe('GET /backoffice/dashboard/summary', () => {
    it('returns 200 with correct shape for superadmin', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as SummaryResponse;
      expect(typeof body.totalUsers).toBe('number');
      expect(typeof body.totalMissions).toBe('number');
      expect(typeof body.activeMissions).toBe('number');
    });

    it('returns 200 with correct shape for admin', async () => {
      await seedSuperadmin();
      await seedAdmin();
      const token = await loginAdmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
    });

    it('returns correct counts after seeding data', async () => {
      await seedSuperadmin();
      await seedTestData();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as SummaryResponse;
      expect(body.totalUsers).toBe(2);
      expect(body.totalMissions).toBe(2);
      expect(body.activeMissions).toBe(1);
    });

    it('returns 401 without auth token', async () => {
      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/summary');

      expect(response.status).toBe(401);
    });

    it('returns 401 with platform user JWT', async () => {
      await seedSuperadmin();
      const userToken = await loginPlatformUser();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/summary')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe('GET /backoffice/dashboard/missions', () => {
    it('returns 200 with correct shape for superadmin', async () => {
      await seedSuperadmin();
      await seedTestData();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as MissionStatsResponse[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      const first = body[0];
      expect(typeof first.missionId).toBe('string');
      expect(typeof first.missionTitle).toBe('string');
      expect(typeof first.stageTitle).toBe('string');
      expect(typeof first.totalUsers).toBe('number');
      expect(typeof first.pending).toBe('number');
      expect(typeof first.accepted).toBe('number');
      expect(typeof first.rejected).toBe('number');
    });

    it('returns only active missions', async () => {
      await seedSuperadmin();
      await seedTestData();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as MissionStatsResponse[];
      expect(body).toHaveLength(1);
      expect(body[0].missionTitle).toBe('Follow @tove on Instagram');
    });

    it('returns correct unique user counts per status', async () => {
      await seedSuperadmin();
      await seedTestData();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const body = response.body as MissionStatsResponse[];
      const mission = body[0];
      expect(mission.totalUsers).toBe(2);
      expect(mission.pending).toBe(1);
      expect(mission.accepted).toBe(1);
      expect(mission.rejected).toBe(0);
    });

    it('returns empty array when no active missions', async () => {
      await seedSuperadmin();
      const token = await loginSuperadmin();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('returns 401 without auth token', async () => {
      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions');

      expect(response.status).toBe(401);
    });

    it('returns 401 with platform user JWT', async () => {
      await seedSuperadmin();
      const userToken = await loginPlatformUser();

      const response = await request(server)
        .get('/api/backoffice/v1/dashboard/missions')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(401);
    });
  });
});
