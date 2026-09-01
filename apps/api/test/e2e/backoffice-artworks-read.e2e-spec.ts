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

interface FractionProjection {
  status: string;
  tokenAddress: string | null;
  totalSupply?: string;
}
interface ArtworkRow {
  id: string;
  title: string;
  status: string;
  fractionContract: FractionProjection | null;
  [k: string]: unknown;
}
interface ListBody {
  data: ArtworkRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/** NOTE: requires the local `tove_test` DB (`yarn db:test:setup`) + Redis. Factory port is faked (no testnet). */
describe('Backoffice artworks read (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;

  const adminEmail = 'aw-read-admin@example.com';
  const adminPassword = 'SuperAdmin1!@#';
  const ARTIST_ID = '00000000-0000-4000-8000-0000000e0001';

  const AW_VERIFIED = '00000000-0000-4000-8000-0000000e0010'; // verified, no contract (CTA)
  const AW_VERIFIED_FAILED = '00000000-0000-4000-8000-0000000e0011'; // verified, failed contract only (CTA)
  const AW_FRACTIONALIZING = '00000000-0000-4000-8000-0000000e0012'; // fractionalizing, deploying
  const AW_FRACTIONALIZED = '00000000-0000-4000-8000-0000000e0013'; // fractionalized, deployed
  const AW_PUBLISHED = '00000000-0000-4000-8000-0000000e0014'; // published (excluded by default)

  const TOKEN_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
  const WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';
  const ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';

  async function seedAdmin(): Promise<void> {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active","created_at","updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'admin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [adminEmail, passwordHash],
    );
  }

  async function seedArtwork(id: string, status: string, title: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO "artworks"
         ("id","status","artist_user_id","title","year","medium","dimensions","artist_name","artist_handle","primary_image_url")
       VALUES ($1,$2,$3,$4,2021,'Oil','100x80','Jane Doe','jane','https://img/${title}.png')
       ON CONFLICT ("id") DO NOTHING`,
      [id, status, ARTIST_ID, title],
    );
  }

  async function seedContract(artworkId: string, status: string, tokenAddress: string | null): Promise<void> {
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("artwork_id","status","wasm_hash","token_name","token_symbol","artist_address","total_supply",
          "artist_retention_pct","treasury_retention_pct","artist_lockup_days","treasury_lockup_days","token_address")
       VALUES ($1,$2,$3,'Northern Lights','NLIGHT',$4,'1000000',10,5,365,730,$5)`,
      [artworkId, status, WASM, ARTIST_ADDR, tokenAddress],
    );
  }

  const login = async (): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    return (res.body as { accessToken: string }).accessToken;
  };

  const list = (token?: string, qs = '') => {
    const req = request(server).get(`/api/backoffice/v1/artworks${qs}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };
  const detail = (id: string, token?: string) => {
    const req = request(server).get(`/api/backoffice/v1/artworks/${id}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

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
    await dataSource.query(
      `INSERT INTO users (id, is_active, kyc_status) VALUES ($1, true, 'not_submitted') ON CONFLICT DO NOTHING`,
      [ARTIST_ID],
    );
    await seedArtwork(AW_VERIFIED, 'verified', 'v');
    await seedArtwork(AW_VERIFIED_FAILED, 'verified', 'vf');
    await seedArtwork(AW_FRACTIONALIZING, 'fractionalizing', 'fzing');
    await seedArtwork(AW_FRACTIONALIZED, 'fractionalized', 'fzed');
    await seedArtwork(AW_PUBLISHED, 'published', 'pub');
    await seedContract(AW_VERIFIED_FAILED, 'failed', null);
    await seedContract(AW_FRACTIONALIZING, 'deploying', null);
    await seedContract(AW_FRACTIONALIZED, 'deployed', TOKEN_ADDR);
  });

  // ---- Positive ----
  it('lists fractionalization-relevant artworks (published excluded), camelCase + envelope', async () => {
    const token = await login();
    const body = (await list(token).expect(200)).body as ListBody;

    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(AW_VERIFIED);
    expect(ids).toContain(AW_FRACTIONALIZING);
    expect(ids).toContain(AW_FRACTIONALIZED);
    expect(ids).not.toContain(AW_PUBLISHED);
    expect(body.meta).toMatchObject({ page: 1, limit: 10, total: 4, totalPages: 1 });

    // camelCase, no snake_case leakage
    for (const key of Object.keys(body.data[0])) expect(key).not.toContain('_');

    const fzed = body.data.find((r) => r.id === AW_FRACTIONALIZED)!;
    expect(fzed.fractionContract).toMatchObject({ status: 'deployed', tokenAddress: TOKEN_ADDR });
    const verified = body.data.find((r) => r.id === AW_VERIFIED)!;
    expect(verified.fractionContract).toBeNull();
  });

  it('detail reflects a deployed contract', async () => {
    const token = await login();
    const body = (await detail(AW_FRACTIONALIZED, token).expect(200)).body as ArtworkRow;
    expect(body.status).toBe('fractionalized');
    expect(body.fractionContract).toMatchObject({ status: 'deployed', tokenAddress: TOKEN_ADDR });
    expect(body.fractionContract!.totalSupply).toBe('1000000');
    expect(typeof body.fractionContract!.totalSupply).toBe('string');
  });

  it('detail reflects a deploying contract (tokenAddress null)', async () => {
    const token = await login();
    const body = (await detail(AW_FRACTIONALIZING, token).expect(200)).body as ArtworkRow;
    expect(body.fractionContract).toMatchObject({ status: 'deploying', tokenAddress: null });
  });

  // ---- Edge: CTA gate ----
  it('CTA gate — verified with no contract → fractionContract null', async () => {
    const token = await login();
    const body = (await detail(AW_VERIFIED, token).expect(200)).body as ArtworkRow;
    expect(body.status).toBe('verified');
    expect(body.fractionContract).toBeNull();
  });

  it('CTA gate survives a prior FAILED deploy → fractionContract null', async () => {
    const token = await login();
    const body = (await detail(AW_VERIFIED_FAILED, token).expect(200)).body as ArtworkRow;
    expect(body.status).toBe('verified');
    expect(body.fractionContract).toBeNull();
  });

  // ---- Edge: filtering & pagination ----
  it('status CSV narrows to the requested subset', async () => {
    const token = await login();
    const body = (await list(token, '?status=fractionalized').expect(200)).body as ListBody;
    expect(body.data.map((r) => r.status)).toEqual(['fractionalized']);
  });

  it('empty CSV behaves as the default filter (published still excluded)', async () => {
    const token = await login();
    const body = (await list(token, '?status=').expect(200)).body as ListBody;
    expect(body.data.map((r) => r.id)).not.toContain(AW_PUBLISHED);
    expect(body.meta.total).toBe(4);
  });

  it('paginates with page/limit', async () => {
    const token = await login();
    const body = (await list(token, '?page=2&limit=2').expect(200)).body as ListBody;
    expect(body.meta).toMatchObject({ page: 2, limit: 2, total: 4, totalPages: 2 });
    expect(body.data.length).toBe(2);
  });

  it('page beyond total → 200 empty data, correct meta', async () => {
    const token = await login();
    const body = (await list(token, '?page=99&limit=10').expect(200)).body as ListBody;
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(4);
  });

  // ---- Negative ----
  it('rejects an out-of-enum status with 400', async () => {
    const token = await login();
    await list(token, '?status=bogus').expect(400);
  });

  it('rejects limit over the max with 400', async () => {
    const token = await login();
    await list(token, '?limit=101').expect(400);
  });

  it('unknown id → 404 ARTWORK_NOT_FOUND', async () => {
    const token = await login();
    const res = await detail('00000000-0000-4000-8000-0000000e9999', token).expect(404);
    expect((res.body as { errorCode?: string }).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  it('malformed (non-UUID) id → 400', async () => {
    const token = await login();
    await detail('not-a-uuid', token).expect(400);
  });

  it('soft-deleted artwork → 404', async () => {
    const token = await login();
    await dataSource.query(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [AW_VERIFIED]);
    await detail(AW_VERIFIED, token).expect(404);
  });

  it('no token → 401 (list + detail)', async () => {
    await list(undefined).expect(401);
    await detail(AW_VERIFIED).expect(401);
  });

  it('non-admin / invalid token → 401', async () => {
    await list('deadbeef.invalid.token').expect(401);
    await detail(AW_VERIFIED, 'deadbeef.invalid.token').expect(401);
  });
});
