import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RELAYER_SERVICE } from '../../src/modules/relayer/relayer.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import {
  createSoftwarePasskey,
  buildAttestation,
  type SoftwarePasskey,
} from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RFQS = '/api/v1/marketplace/rfqs';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const CONTRACT_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';

interface BeginResponse {
  options: { challenge: string };
}
interface FinishResponse {
  accessToken: string;
  contractAddress: string;
}
interface RegisteredUser extends FinishResponse {
  passkey: SoftwarePasskey;
}
interface RfqResponse {
  id: string;
  collectorSub: string;
  artworkId: string;
  fractionContractId: string;
  fractionCount: string;
  maxPricePerFractionStroops: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  balanceWarning?: { requiredStroops: string; availableStroops: string };
}
interface ErrorResponse {
  errorCode: string;
}

describe('Marketplace RFQ creation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let server: object;
  const relayer = new FakeRelayerService();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const entity of ds.entityMetadatas) {
      await ds.getRepository(entity.name).query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
    }
  });

  async function registerUser(email: string, whitelist = true): Promise<RegisteredUser> {
    const passkey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({
      passkey,
      challenge: (begin.body as BeginResponse).options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const user = { ...(finish.body as FinishResponse), passkey };
    if (whitelist) {
      await ds.query(
        `UPDATE users SET kyc_status='whitelisted' WHERE id = (SELECT user_id FROM wallets WHERE contract_address=$1)`,
        [user.contractAddress],
      );
    }
    return user;
  }

  /** Seed an artwork; when `deployed`, also seed its deployed fraction_contract. Returns the artwork id. */
  async function seedArtwork(deployed: boolean): Promise<string> {
    const users = await ds.query<{ id: string }[]>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
    );
    const artworks = await ds.query<{ id: string }[]>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ($1, $2, 'A') RETURNING id`,
      [deployed ? 'fractionalized' : 'verified', users[0].id],
    );
    if (deployed) {
      await ds.query(
        `INSERT INTO fraction_contracts (
           artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
           total_supply, artist_retention_pct, treasury_retention_pct,
           artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
         ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
           '1000000', 10, 5, '100000', '50000', 365, 730)`,
        [artworks[0].id, CONTRACT_ADDR, WASM, ARTIST_ADDR],
      );
    }
    return artworks[0].id;
  }

  const key = () => `${randomUUID().slice(0, 8)}-rfq`;

  function post(token: string, idk: string, body: object) {
    return request(server).post(RFQS).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idk).send(body);
  }

  const validBody = (artworkId: string, patch: object = {}) => ({
    artworkId: artworkId,
    fractionCount: 100,
    maxPricePerFractionStroops: '150000000',
    ...patch,
  });

  // ── AC-1: valid RFQ created (default 48h expiry) ────────────────────────────────────────────────────
  it('AC-1: creates an open RFQ with expiresAt = createdAt + 48h (default)', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-happy@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000000'); // funded → no warning

    const res = await post(user.accessToken, key(), validBody(artworkId)).expect(201);
    const body = res.body as RfqResponse;
    expect(body.status).toBe('open');
    expect(body.artworkId).toBe(artworkId);
    expect(body.fractionContractId).toBeTruthy();
    expect(body.balanceWarning).toBeUndefined();

    const deltaMs = new Date(body.expiresAt).getTime() - new Date(body.createdAt).getTime();
    expect(deltaMs).toBeGreaterThan(47.9 * 3_600_000);
    expect(deltaMs).toBeLessThan(48.1 * 3_600_000);
  });

  it('honors an explicit expiryHours', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-expiry@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000000');

    const res = await post(user.accessToken, key(), validBody(artworkId, { expiryHours: 72 })).expect(201);
    const body = res.body as RfqResponse;
    const deltaMs = new Date(body.expiresAt).getTime() - new Date(body.createdAt).getTime();
    expect(deltaMs).toBeGreaterThan(71.9 * 3_600_000);
    expect(deltaMs).toBeLessThan(72.1 * 3_600_000);
  });

  // ── AC-2: non-fractionalized artwork rejected ───────────────────────────────────────────────────────
  it('AC-2: a non-fractionalized artwork is rejected 422 RFQ_ARTWORK_NOT_FRACTIONALIZED', async () => {
    const artworkId = await seedArtwork(false); // no deployed contract
    const user = await registerUser('rfq-notfrac@example.com');
    const res = await post(user.accessToken, key(), validBody(artworkId)).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('RFQ_ARTWORK_NOT_FRACTIONALIZED');
  });

  it('a missing artwork is rejected 404 ARTWORK_NOT_FOUND', async () => {
    const user = await registerUser('rfq-noart@example.com');
    const res = await post(user.accessToken, key(), validBody(randomUUID())).expect(404);
    expect((res.body as ErrorResponse).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  // ── AC-3: insufficient balance soft-warned ──────────────────────────────────────────────────────────
  it('AC-3: an under-funded collector still gets 201 with a balanceWarning', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-poor@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100'); // far below 150000000 × 100

    const res = await post(user.accessToken, key(), validBody(artworkId)).expect(201);
    const body = res.body as RfqResponse;
    expect(body.status).toBe('open');
    expect(body.balanceWarning).toEqual({ requiredStroops: '15000000000', availableStroops: '100' });
  });

  // ── active-open ceiling ─────────────────────────────────────────────────────────────────────────────
  it('rejects the 26th open RFQ 422 RFQ_TOO_MANY_ACTIVE (MAX_ACTIVE_OPEN_RFQS = 25)', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-ceiling@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000000');
    const [{ user_id: collectorSub }] = await ds.query<{ user_id: string }[]>(
      `SELECT user_id FROM wallets WHERE contract_address=$1`,
      [user.contractAddress],
    );
    const [{ id: contractId }] = await ds.query<{ id: string }[]>(
      `SELECT id FROM fraction_contracts WHERE artwork_id=$1`,
      [artworkId],
    );
    // Seed 25 open RFQs directly (distinct idempotency hashes) so the collector is exactly at the ceiling.
    for (let i = 0; i < 25; i++) {
      await ds.query(
        `INSERT INTO rfqs (collector_sub, artwork_id, fraction_contract_id, fraction_count,
           max_price_per_fraction_stroops, expires_at, status, idempotency_key_hash)
         VALUES ($1,$2,$3,'1','150000000', now() + interval '48 hours', 'open', $4)`,
        [collectorSub, artworkId, contractId, Buffer.alloc(32, i)],
      );
    }
    const res = await post(user.accessToken, key(), validBody(artworkId)).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('RFQ_TOO_MANY_ACTIVE');
  });

  // ── whitelist gate ──────────────────────────────────────────────────────────────────────────────────
  it('a non-whitelisted collector is blocked 403 RFQ_NOT_WHITELISTED', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-notkyc@example.com', false);
    const res = await post(user.accessToken, key(), validBody(artworkId)).expect(403);
    expect((res.body as ErrorResponse).errorCode).toBe('RFQ_NOT_WHITELISTED');
  });

  // ── auth + header edges ─────────────────────────────────────────────────────────────────────────────
  it('rejects a create without an Idempotency-Key (400)', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-noidem@example.com');
    await request(server)
      .post(RFQS)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(validBody(artworkId))
      .expect(400);
  });

  it('rejects an unauthenticated create (401)', async () => {
    const artworkId = await seedArtwork(true);
    await request(server).post(RFQS).set('Idempotency-Key', key()).send(validBody(artworkId)).expect(401);
  });

  // ── idempotency ─────────────────────────────────────────────────────────────────────────────────────
  it('replays the same 201 for a repeated key + body, writing exactly one row', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-replay@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000000');
    const idk = key();

    const first = (await post(user.accessToken, idk, validBody(artworkId)).expect(201)).body as RfqResponse;
    const second = (await post(user.accessToken, idk, validBody(artworkId)).expect(201)).body as RfqResponse;
    expect(second.id).toBe(first.id);

    const rows = await ds.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM rfqs WHERE collector_sub = $1`, [
      first.collectorSub,
    ]);
    expect(rows[0].n).toBe('1');
  });

  it('a reused key with a different body is 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const artworkId = await seedArtwork(true);
    const user = await registerUser('rfq-mismatch@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000000');
    const idk = key();

    await post(user.accessToken, idk, validBody(artworkId)).expect(201);
    const res = await post(user.accessToken, idk, validBody(artworkId, { fractionCount: 200 })).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });
});
