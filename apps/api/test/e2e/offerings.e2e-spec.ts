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

interface OfferingBody {
  id: string;
  artworkId: string;
  fractionContractId: string;
  status: string;
  lowPriceStroops: string;
  highPriceStroops: string;
  publicFloat: string;
  windowOpenAt: string;
  windowCloseAt: string;
  createdAt: string;
  errorCode?: string;
}

/**
 * TOV-152 offering-planning endpoint (POST /api/backoffice/v1/offerings).
 *
 * NOTE: requires the local `tove_test` DB (migrated: `yarn db:test:setup`) + Redis (idempotency store).
 * No Soroban call is made — planning is a pure DB write reading the already-persisted `fraction_contracts`
 * row, so nothing external is touched. The throttler storage is overridden with the no-op fake.
 */
describe('Offerings planning (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const adminEmail = 'off-admin@example.com';
  const adminPassword = 'SuperAdmin1!@#';

  const ARTIST_ID = '00000000-0000-4000-8000-0000000e0001';

  // Primary fixture: an artwork with a DEPLOYED fraction_contract whose retentions leave a real float.
  const ARTWORK_ID = '00000000-0000-4000-8000-0000000e0010';
  const FC_ID = '00000000-0000-4000-8000-0000000e0011';
  // total_supply − artist_retention − treasury_retention = 1_000_000_000 − 100_000_000 − 50_000_000.
  const EXPECTED_FLOAT = '850000000';

  // Secondary fixtures (seeded only by the tests that need them).
  const ARTWORK_NO_FC_ID = '00000000-0000-4000-8000-0000000e0020'; // no deployed contract at all
  const ARTWORK_NO_FLOAT_ID = '00000000-0000-4000-8000-0000000e0030'; // retentions == total_supply
  const FC_NO_FLOAT_ID = '00000000-0000-4000-8000-0000000e0031';

  // A valid on-chain-shaped 56-char contract address (C + 55 base32 chars) for the deployed contract.
  const TOKEN_ADDRESS = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const WASM_HASH = 'a'.repeat(64);

  const validBody = {
    artwork_id: ARTWORK_ID,
    low_price_stroops: '50000000',
    high_price_stroops: '150000000',
    window_open_at: '2026-09-01T00:00:00Z',
    window_close_at: '2026-09-08T00:00:00Z',
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

  async function seedArtist(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "users" ("id","email","password_hash","is_active") VALUES ($1, NULL, NULL, true)
       ON CONFLICT ("id") DO NOTHING`,
      [ARTIST_ID],
    );
  }

  async function seedArtwork(artworkId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title")
       VALUES ($1,'fractionalized',$2,'Northern Lights') ON CONFLICT ("id") DO NOTHING`,
      [artworkId, ARTIST_ID],
    );
  }

  // Seed a DEPLOYED fraction_contract (valid per its CHECKs; retention amounts non-null).
  async function seedDeployedContract(
    fcId: string,
    artworkId: string,
    totalSupply: string,
    artistRetentionAmount: string,
    treasuryRetentionAmount: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol",
          "artist_address","total_supply","artist_retention_pct","treasury_retention_pct",
          "artist_retention_amount","treasury_retention_amount","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deployed',$3,$4,'Northern Lights','NLIGHT',$5,$6,10,5,$7,$8,365,730)
       ON CONFLICT ("id") DO NOTHING`,
      [
        fcId,
        artworkId,
        TOKEN_ADDRESS,
        WASM_HASH,
        ARTIST_ADDRESS,
        totalSupply,
        artistRetentionAmount,
        treasuryRetentionAmount,
      ],
    );
  }

  const login = async (): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    return (res.body as { accessToken: string }).accessToken;
  };

  const post = (token?: string, key = 'k1', body: Record<string, unknown> = validBody) => {
    const req = request(server).post('/api/backoffice/v1/offerings');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
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
    await seedArtist();
    // Primary fixture: fractionalized artwork with a deployed contract → float 850_000_000.
    await seedArtwork(ARTWORK_ID);
    await seedDeployedContract(FC_ID, ARTWORK_ID, '1000000000', '100000000', '50000000');
  });

  it('201 happy path: creates a planned offering with the correct public float and persists the row', async () => {
    const token = await login();
    const res = await post(token, 'k-happy').expect(201);
    const body = res.body as OfferingBody;

    expect(body).toMatchObject({
      artworkId: ARTWORK_ID,
      fractionContractId: FC_ID,
      status: 'planned',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      publicFloat: EXPECTED_FLOAT,
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.windowOpenAt).toBe('2026-09-01T00:00:00.000Z');
    expect(body.windowCloseAt).toBe('2026-09-08T00:00:00.000Z');
    expect(typeof body.createdAt).toBe('string');

    // Assert the row actually persisted with the snapshotted float and the source contract FK.
    const rows: Array<Record<string, string>> = await dataSource.query(
      `SELECT "id","artwork_id","fraction_contract_id","status","public_float",
              "low_price_stroops","high_price_stroops","created_by_admin_sub"
         FROM "offerings" WHERE "artwork_id" = $1`,
      [ARTWORK_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.id,
      artwork_id: ARTWORK_ID,
      fraction_contract_id: FC_ID,
      status: 'planned',
      public_float: EXPECTED_FLOAT,
      low_price_stroops: '50000000',
      high_price_stroops: '150000000',
    });
    expect(rows[0].created_by_admin_sub).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('422 OFFERING_WINDOW_INVALID when window_open_at >= window_close_at', async () => {
    const token = await login();
    const res = await post(token, 'k-window', {
      ...validBody,
      window_open_at: '2026-09-08T00:00:00Z',
      window_close_at: '2026-09-01T00:00:00Z',
    }).expect(422);
    expect((res.body as OfferingBody).errorCode).toBe('OFFERING_WINDOW_INVALID');
  });

  it('422 OFFERING_BAND_INVALID when low >= high', async () => {
    const token = await login();
    const res = await post(token, 'k-band', {
      ...validBody,
      low_price_stroops: '150000000',
      high_price_stroops: '50000000',
    }).expect(422);
    expect((res.body as OfferingBody).errorCode).toBe('OFFERING_BAND_INVALID');
  });

  it('422 OFFERING_NO_FLOAT when retentions consume the whole supply', async () => {
    await seedArtwork(ARTWORK_NO_FLOAT_ID);
    // total_supply == artist_retention + treasury_retention → public_float 0.
    await seedDeployedContract(FC_NO_FLOAT_ID, ARTWORK_NO_FLOAT_ID, '1000000000', '600000000', '400000000');

    const token = await login();
    const res = await post(token, 'k-nofloat', {
      ...validBody,
      artwork_id: ARTWORK_NO_FLOAT_ID,
    }).expect(422);
    expect((res.body as OfferingBody).errorCode).toBe('OFFERING_NO_FLOAT');
  });

  it('409 OFFERING_ARTWORK_NOT_FRACTIONALIZED when the artwork has no deployed contract', async () => {
    await seedArtwork(ARTWORK_NO_FC_ID); // artwork exists but no fraction_contract

    const token = await login();
    const res = await post(token, 'k-notfrac', {
      ...validBody,
      artwork_id: ARTWORK_NO_FC_ID,
    }).expect(409);
    expect((res.body as OfferingBody).errorCode).toBe('OFFERING_ARTWORK_NOT_FRACTIONALIZED');
  });

  it('409 OFFERING_ALREADY_ACTIVE on a second plan for the same artwork', async () => {
    const token = await login();
    await post(token, 'k-first').expect(201);
    // Different idempotency key, same valid body → passes idempotency, hits the partial-unique index.
    const res = await post(token, 'k-second').expect(409);
    expect((res.body as OfferingBody).errorCode).toBe('OFFERING_ALREADY_ACTIVE');

    const rows: Array<Record<string, string>> = await dataSource.query(
      `SELECT "id" FROM "offerings" WHERE "artwork_id" = $1`,
      [ARTWORK_ID],
    );
    expect(rows).toHaveLength(1);
  });

  it('idempotency replay: same key + same body twice → one row, identical 201 body', async () => {
    const token = await login();
    const first = (await post(token, 'k-replay').expect(201)).body as OfferingBody;
    const replay = (await post(token, 'k-replay').expect(201)).body as OfferingBody;

    expect(replay).toEqual(first);

    const rows: Array<Record<string, string>> = await dataSource.query(
      `SELECT "id" FROM "offerings" WHERE "artwork_id" = $1`,
      [ARTWORK_ID],
    );
    expect(rows).toHaveLength(1);
  });

  it('401 when no bearer token is supplied', async () => {
    await post(undefined, 'k-401').expect(401);
  });

  it('400 when the Idempotency-Key header is missing', async () => {
    const token = await login();
    await post(token, '').expect(400);
  });

  // NOTE: A 403 (authenticated-but-forbidden) case is intentionally omitted. The endpoint accepts BOTH
  // admin roles that exist (`@AdminRoles(ADMIN, SUPERADMIN)` and the DB CHECK admits only those two), so
  // there is no admin role that authenticates yet lacks permission. A public/user JWT is signed with a
  // different secret and fails `BackofficeGuard` verification → 401 (covered above), not 403. The
  // fractionalization e2e template mints no user token either.
});
