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
import { FRACTION_READ_SERVICE } from '../../src/modules/fractionalization/fraction-read.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { FakeFractionReadService } from '../shared/fake-fraction-read';
import { createSoftwarePasskey, buildAttestation, type SoftwarePasskey } from '../shared/webauthn-authenticator';
import { seedArtworkWithContract, seedOpenRfq, seedQuote, type QueryFn } from '../shared/seed-marketplace';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';

interface BeginResponse { options: { challenge: string } }
interface FinishResponse { accessToken: string; contractAddress: string }
interface RegisteredUser extends FinishResponse { passkey: SoftwarePasskey; userId: string }
interface QuoteRow {
  quoteId: string; sellerHandle: string | null; fractionCount: string;
  pricePerFractionStroops: string; grossStroops: string; validUntil: string; status: string; acceptable: boolean;
}
interface RfqDetail { id: string; artworkId: string; artworkSlug: string | null; status: string; quotes: QuoteRow[] }

describe('Marketplace RFQ detail read (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let server: object;
  const q: QueryFn = (text: string, params: unknown[] = []) => ds.query(text, params);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(new FakeRelayerService())
      .overrideProvider(FRACTION_READ_SERVICE)
      .useValue(new FakeFractionReadService())
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

  async function registerUser(email: string): Promise<RegisteredUser> {
    const passkey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({
      passkey,
      challenge: (begin.body as BeginResponse).options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const body = finish.body as FinishResponse;
    const rows = await q<{ user_id: string }>(`SELECT user_id FROM wallets WHERE contract_address=$1`, [body.contractAddress]);
    return { ...body, passkey, userId: rows[0].user_id };
  }

  async function seedSeller(handle: string): Promise<string> {
    const rows = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status, handle) VALUES (true, 'not_submitted', $1) RETURNING id`,
      [handle],
    );
    return rows[0].id;
  }

  const get = (token: string, rfqId: string) =>
    request(server).get(`/api/v1/marketplace/rfqs/${rfqId}`).set('Authorization', `Bearer ${token}`);

  // ── positive ──────────────────────────────────────────────────────────────
  it('returns the buyer RFQ + open quotes sorted price ASC, with handles + derived acceptable', async () => {
    const buyer = await registerUser('detail-buyer@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const handleHi = `chigh_${randomUUID().slice(0, 8)}`;
    const handleLo = `clow_${randomUUID().slice(0, 8)}`;
    const sellerHi = await seedSeller(handleHi);
    const sellerLo = await seedSeller(handleLo);
    // authorized @ 20, unauthorized @ 10, plus a canceled quote (excluded).
    await seedQuote(q, rfqId, contractId, { holderSub: sellerHi, price: '20', count: '5', authorized: true });
    await seedQuote(q, rfqId, contractId, { holderSub: sellerLo, price: '10', count: '3' });
    await seedQuote(q, rfqId, contractId, { holderSub: randomUUID(), status: 'canceled' });

    const body = (await get(buyer.accessToken, rfqId).expect(200)).body as RfqDetail;
    expect(body.id).toBe(rfqId);
    expect(body.status).toBe('open');
    expect(body.artworkSlug).toMatch(/^a-/); // artwork title 'A' → slug 'a-<hex>'
    expect(body.quotes).toHaveLength(2);
    expect(body.quotes[0].pricePerFractionStroops).toBe('10'); // price ASC
    expect(body.quotes[0].sellerHandle).toBe(handleLo);
    expect(body.quotes[0].acceptable).toBe(false);
    expect(body.quotes[1].pricePerFractionStroops).toBe('20');
    expect(body.quotes[1].sellerHandle).toBe(handleHi);
    expect(body.quotes[1].acceptable).toBe(true);
    expect(body.quotes[1].grossStroops).toBe('100'); // 5 × 20
    // No secret leakage.
    expect(JSON.stringify(body)).not.toMatch(/seller_auth_entry|holderSub|holder_sub/);
  });

  it('an RFQ with no quotes returns an empty quotes array', async () => {
    const buyer = await registerUser('detail-empty@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const body = (await get(buyer.accessToken, rfqId).expect(200)).body as RfqDetail;
    expect(body.quotes).toEqual([]);
  });

  it('an authorized-but-lapsed quote is acceptable:false', async () => {
    const buyer = await registerUser('detail-lapsed@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    await seedQuote(q, rfqId, contractId, {
      authorized: true,
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      validUntil: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    const body = (await get(buyer.accessToken, rfqId).expect(200)).body as RfqDetail;
    expect(body.quotes[0].acceptable).toBe(false);
  });

  // ── negative ────────────────────────────────────────────────────────────
  it('a non-owner gets 404 QUOTE_RFQ_NOT_FOUND (no existence oracle)', async () => {
    const buyer = await registerUser('detail-owner@example.com');
    const stranger = await registerUser('detail-stranger@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const res = await get(stranger.accessToken, rfqId).expect(404);
    expect((res.body as { errorCode: string }).errorCode).toBe('QUOTE_RFQ_NOT_FOUND');
  });

  it('a missing RFQ id also 404s (indistinguishable from not-owned)', async () => {
    const buyer = await registerUser('detail-missing@example.com');
    await get(buyer.accessToken, randomUUID()).expect(404);
  });

  it('a non-uuid id is rejected 400 by the pipe', async () => {
    const buyer = await registerUser('detail-badid@example.com');
    await get(buyer.accessToken, 'not-a-uuid').expect(400);
  });

  it('an unauthenticated request is rejected 401', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    await request(server).get(`/api/v1/marketplace/rfqs/${rfqId}`).expect(401);
  });
});
