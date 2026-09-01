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
import { insertOffering } from '../shared/seed-offering';

interface DetailBody {
  id: string;
  status: string;
  activeOffering: {
    id: string;
    status: string;
    lowPriceStroops: string;
    highPriceStroops: string;
    publicFloat: string;
    windowOpenAt: string;
    windowCloseAt: string;
  } | null;
}

/**
 * TOV-153 activeOffering embed on the admin artwork detail (GET /api/backoffice/v1/artworks/:id).
 * Requires local `tove_test` DB + Redis; throttler storage overridden with the no-op fake.
 */
describe('Artwork detail — activeOffering embed (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const adminEmail = 'detail-admin@example.com';
  const adminPassword = 'SuperAdmin1!@#';
  const ADMIN_SUB = '00000000-0000-4000-8000-00000000ad11';
  const ARTIST_ID = '00000000-0000-4000-8000-0000000c0001';
  const ARTWORK_ID = '00000000-0000-4000-8000-0000000c0010';
  const FC_ID = '00000000-0000-4000-8000-0000000c0011';

  const TOKEN_ADDRESS = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const WASM_HASH = 'a'.repeat(64);

  const path = (id: string) => `/api/backoffice/v1/artworks/${id}`;

  async function seedBase(): Promise<void> {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active","created_at","updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'admin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [adminEmail, passwordHash],
    );
    await dataSource.query(
      `INSERT INTO "users" ("id","email","password_hash","is_active") VALUES ($1, NULL, NULL, true)
       ON CONFLICT ("id") DO NOTHING`,
      [ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title")
       VALUES ($1,'fractionalized',$2,'Northern Lights') ON CONFLICT ("id") DO NOTHING`,
      [ARTWORK_ID, ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol",
          "artist_address","total_supply","artist_retention_pct","treasury_retention_pct",
          "artist_retention_amount","treasury_retention_amount","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deployed',$3,$4,'Northern Lights','NLIGHT',$5,'1000000000',10,5,'100000000','50000000',365,730)
       ON CONFLICT ("id") DO NOTHING`,
      [FC_ID, ARTWORK_ID, TOKEN_ADDRESS, WASM_HASH, ARTIST_ADDRESS],
    );
  }

  async function seedOffering(status: string): Promise<string> {
    // TOV-154 CHK_off_approved_has_escrow: post-approval statuses must carry an escrow address.
    const escrowAddress = ['approved', 'opened', 'subscribed', 'settled'].includes(status)
      ? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
      : null;
    return insertOffering((t: string, p?: unknown[]) => dataSource.query(t, p), {
      artworkId: ARTWORK_ID,
      fractionContractId: FC_ID,
      status,
      publicFloat: '850000000',
      windowOpenAt: '2026-09-01T00:00:00Z',
      windowCloseAt: '2026-09-08T00:00:00Z',
      createdByAdminSub: ADMIN_SUB,
      escrowContractAddress: escrowAddress,
    });
  }

  const login = async (): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    return (res.body as { accessToken: string }).accessToken;
  };

  const getDetail = (token: string) =>
    request(server).get(path(ARTWORK_ID)).set('Authorization', `Bearer ${token}`);

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
    await seedBase();
  });

  it('embeds the activeOffering summary + Cache-Control: no-store when a planned offering exists (positive)', async () => {
    const offeringId = await seedOffering('planned');
    const token = await login();
    const res = await getDetail(token).expect(200);
    const body = res.body as DetailBody;
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.activeOffering).toEqual({
      id: offeringId,
      status: 'planned',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      publicFloat: '850000000',
      windowOpenAt: '2026-09-01T00:00:00.000Z',
      windowCloseAt: '2026-09-08T00:00:00.000Z',
    });
  });

  it('activeOffering is null when the artwork has no offering (CTA to plan is shown) (negative)', async () => {
    const token = await login();
    const res = await getDetail(token).expect(200);
    expect((res.body as DetailBody).activeOffering).toBeNull();
  });

  it('activeOffering is null when the only offering is terminal (settled) (edge)', async () => {
    await seedOffering('settled');
    const token = await login();
    const res = await getDetail(token).expect(200);
    expect((res.body as DetailBody).activeOffering).toBeNull();
  });

  it('401 without a bearer token (negative)', async () => {
    await request(server).get(path(ARTWORK_ID)).expect(401);
  });
});
