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

interface PreviewBody {
  publicFloat: string;
  totalSupply: string;
  artistRetentionAmount: string;
  treasuryRetentionAmount: string;
  lowPriceStroops?: string;
  highPriceStroops?: string;
  estimatedRaiseLow?: string;
  estimatedRaiseHigh?: string;
  errorCode?: string;
}

/**
 * TOV-153 offering-planning preview (GET /api/backoffice/v1/artworks/:id/offering-preview).
 * Pure read; mirrors the POST offerings error contract (band/float parity). Requires local `tove_test`
 * DB + Redis; throttler storage overridden with the no-op fake.
 */
describe('Offering preview (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const adminEmail = 'preview-admin@example.com';
  const adminPassword = 'SuperAdmin1!@#';
  const ARTIST_ID = '00000000-0000-4000-8000-0000000f0001';

  const ARTWORK_ID = '00000000-0000-4000-8000-0000000f0010'; // deployed, float 850_000_000
  const FC_ID = '00000000-0000-4000-8000-0000000f0011';
  const EXPECTED_FLOAT = '850000000'; // 1_000_000_000 − 100_000_000 − 50_000_000

  const ARTWORK_DEPLOYING_ID = '00000000-0000-4000-8000-0000000f0020';
  const FC_DEPLOYING_ID = '00000000-0000-4000-8000-0000000f0021';
  const ARTWORK_NO_FLOAT_ID = '00000000-0000-4000-8000-0000000f0030';
  const FC_NO_FLOAT_ID = '00000000-0000-4000-8000-0000000f0031';
  const UNKNOWN_ARTWORK_ID = '00000000-0000-4000-8000-0000000fdead';

  const TOKEN_ADDRESS = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const WASM_HASH = 'a'.repeat(64);

  const path = (id: string) => `/api/backoffice/v1/artworks/${id}/offering-preview`;

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
      [fcId, artworkId, TOKEN_ADDRESS, WASM_HASH, ARTIST_ADDRESS, totalSupply, artistRetentionAmount, treasuryRetentionAmount],
    );
  }

  // A still-deploying contract: token_address + retention amounts null (not yet latched).
  async function seedDeployingContract(fcId: string, artworkId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("id","artwork_id","status","wasm_hash","token_name","token_symbol","artist_address",
          "total_supply","artist_retention_pct","treasury_retention_pct","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deploying',$3,'Northern Lights','NLIGHT',$4,'1000000000',10,5,365,730)
       ON CONFLICT ("id") DO NOTHING`,
      [fcId, artworkId, WASM_HASH, ARTIST_ADDRESS],
    );
  }

  const login = async (): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    return (res.body as { accessToken: string }).accessToken;
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
    await seedArtwork(ARTWORK_ID);
    await seedDeployedContract(FC_ID, ARTWORK_ID, '1000000000', '100000000', '50000000');
  });

  it('200 with a band → public float + estimated raise range, Cache-Control: no-store (positive)', async () => {
    const token = await login();
    const res = await request(server)
      .get(path(ARTWORK_ID))
      .query({ low_price_stroops: '50000000', high_price_stroops: '150000000' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as PreviewBody;
    expect(body).toEqual({
      publicFloat: EXPECTED_FLOAT,
      totalSupply: '1000000000',
      artistRetentionAmount: '100000000',
      treasuryRetentionAmount: '50000000',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      estimatedRaiseLow: String(50000000n * 850000000n),
      estimatedRaiseHigh: String(150000000n * 850000000n),
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('200 with no band → float + components only, no estimatedRaise* keys (positive/edge)', async () => {
    const token = await login();
    const res = await request(server).get(path(ARTWORK_ID)).set('Authorization', `Bearer ${token}`).expect(200);
    const body = res.body as PreviewBody;
    expect(body).toEqual({
      publicFloat: EXPECTED_FLOAT,
      totalSupply: '1000000000',
      artistRetentionAmount: '100000000',
      treasuryRetentionAmount: '50000000',
    });
    expect(body.estimatedRaiseLow).toBeUndefined();
  });

  it('400 when the band is supplied partially (only one bound) (negative)', async () => {
    const token = await login();
    await request(server)
      .get(path(ARTWORK_ID))
      .query({ low_price_stroops: '50000000' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('400 when a band bound is a malformed integer (negative)', async () => {
    const token = await login();
    await request(server)
      .get(path(ARTWORK_ID))
      .query({ low_price_stroops: '-5', high_price_stroops: '100' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('400 on a malformed artwork UUID (negative)', async () => {
    const token = await login();
    await request(server).get(path('not-a-uuid')).set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('404 ARTWORK_NOT_FOUND for an unknown artwork (negative)', async () => {
    const token = await login();
    const res = await request(server).get(path(UNKNOWN_ARTWORK_ID)).set('Authorization', `Bearer ${token}`).expect(404);
    expect((res.body as PreviewBody).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  it('409 OFFERING_ARTWORK_NOT_FRACTIONALIZED while the contract is still deploying (negative)', async () => {
    await seedArtwork(ARTWORK_DEPLOYING_ID);
    await seedDeployingContract(FC_DEPLOYING_ID, ARTWORK_DEPLOYING_ID);
    const token = await login();
    const res = await request(server)
      .get(path(ARTWORK_DEPLOYING_ID))
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect((res.body as PreviewBody).errorCode).toBe('OFFERING_ARTWORK_NOT_FRACTIONALIZED');
  });

  it('422 OFFERING_BAND_INVALID when low >= high (negative)', async () => {
    const token = await login();
    const res = await request(server)
      .get(path(ARTWORK_ID))
      .query({ low_price_stroops: '150000000', high_price_stroops: '50000000' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    expect((res.body as PreviewBody).errorCode).toBe('OFFERING_BAND_INVALID');
  });

  it('422 OFFERING_NO_FLOAT when retentions consume the supply (edge)', async () => {
    await seedArtwork(ARTWORK_NO_FLOAT_ID);
    await seedDeployedContract(FC_NO_FLOAT_ID, ARTWORK_NO_FLOAT_ID, '1000000000', '600000000', '400000000');
    const token = await login();
    const res = await request(server).get(path(ARTWORK_NO_FLOAT_ID)).set('Authorization', `Bearer ${token}`).expect(422);
    expect((res.body as PreviewBody).errorCode).toBe('OFFERING_NO_FLOAT');
  });

  it('401 when no bearer token is supplied (negative)', async () => {
    await request(server).get(path(ARTWORK_ID)).expect(401);
  });

  // No 403 case: @AdminRoles(ADMIN, SUPERADMIN) admits both roles that exist, and a non-admin JWT fails
  // BackofficeGuard verification → 401 (above), not 403. See the offerings e2e for the full rationale.
});
