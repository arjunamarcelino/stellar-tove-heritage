import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { FRACTION_FACTORY_SERVICE } from '../../src/modules/fractionalization/fraction-factory.service.interface';
import { FakeFractionFactoryService } from '../../src/modules/fractionalization/fake-fraction-factory.service';

interface StatusBody {
  artworkId: string;
  fractionContractId: string;
  status: string;
  tokenAddress: string | null;
  errorCode?: string;
}

/**
 * NOTE: requires the local `tove_test` DB (migrated: `yarn db:test:setup`) + Redis. The factory port is
 * overridden with the deterministic fake, so no testnet is touched. The worker runs in-process via BullMQ.
 */
describe('Fractionalization (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const adminEmail = 'fx-admin@example.com';
  const adminPassword = 'SuperAdmin1!@#';
  const ARTIST_ID = '00000000-0000-4000-8000-0000000f0001';
  const WALLET_ID = '00000000-0000-4000-8000-0000000f0002';
  const ARTWORK_ID = '00000000-0000-4000-8000-0000000f0010';
  const ARTIST_PUBKEY = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const validBody = {
    total_supply: 1000000,
    artist_retention_pct: 10,
    treasury_retention_pct: 5,
    artist_lockup_days: 365,
    treasury_lockup_days: 730,
    name: 'Northern Lights',
    symbol: 'NLIGHT',
  };

  async function seedAdmin(): Promise<void> {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active","created_at","updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'admin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [adminEmail, passwordHash],
    );
  }

  async function seedVerifiedArtwork(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "users" ("id","email","password_hash","is_active") VALUES ($1, NULL, NULL, true)
       ON CONFLICT ("id") DO NOTHING`,
      [ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "wallets" ("id","user_id","public_key","contract_address","kind","is_primary","status")
       VALUES ($1,$2,$3,NULL,'byow',true,'active') ON CONFLICT ("id") DO NOTHING`,
      [WALLET_ID, ARTIST_ID, ARTIST_PUBKEY],
    );
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title") VALUES ($1,'verified',$2,'Northern Lights')
       ON CONFLICT ("id") DO NOTHING`,
      [ARTWORK_ID, ARTIST_ID],
    );
  }

  const login = async (): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    return (res.body as { accessToken: string }).accessToken;
  };

  const post = (token?: string, key = 'k1', body = validBody) => {
    const req = request(server).post(`/api/backoffice/v1/artworks/${ARTWORK_ID}/fractionalize`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const getStatus = (token: string) =>
    request(server)
      .get(`/api/backoffice/v1/artworks/${ARTWORK_ID}/fractionalization`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(FRACTION_FACTORY_SERVICE)
      .useClass(FakeFractionFactoryService)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as object;
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    await seedAdmin();
    await seedVerifiedArtwork();
  });

  it('rejects an unauthenticated request with 401', async () => {
    await post(undefined).expect(401);
  });

  it('rejects a missing Idempotency-Key with 400', async () => {
    const token = await login();
    await post(token, '').expect(400);
  });

  it('rejects retention percentages summing over 100 with 400 (DTO constraint via ValidationPipe)', async () => {
    const token = await login();
    await post(token, 'k-bad', { ...validBody, artist_retention_pct: 60, treasury_retention_pct: 41 }).expect(400);
  });

  it('happy path: 202 deploying → worker drains → deployed with a token address', async () => {
    const token = await login();
    const res = await post(token, 'k-happy').expect(202);
    expect(res.body as StatusBody).toMatchObject({ artworkId: ARTWORK_ID, status: 'deploying' });

    // Poll the status endpoint until the in-process worker latches `deployed`.
    let status = 'deploying';
    let tokenAddress: string | null = null;
    for (let i = 0; i < 30 && status !== 'deployed'; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const s = (await getStatus(token).expect(200)).body as StatusBody;
      status = s.status;
      tokenAddress = s.tokenAddress;
    }
    expect(status).toBe('deployed');
    expect(tokenAddress).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it('duplicate deploy after fractionalized → 409', async () => {
    const token = await login();
    await post(token, 'k1').expect(202);
    for (let i = 0; i < 30; i++) {
      const s = (await getStatus(token)).body as StatusBody;
      if (s.status === 'deployed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const dup = await post(token, 'k2').expect(409);
    expect((dup.body as StatusBody).errorCode).toBe('ARTWORK_ALREADY_FRACTIONALIZED');
  });

  it('same Idempotency-Key replays the original 202 (no second contract)', async () => {
    const token = await login();
    const first = (await post(token, 'k-replay').expect(202)).body as StatusBody;
    const replay = (await post(token, 'k-replay').expect(202)).body as StatusBody;
    expect(replay.fractionContractId).toBe(first.fractionContractId);
  });
});
