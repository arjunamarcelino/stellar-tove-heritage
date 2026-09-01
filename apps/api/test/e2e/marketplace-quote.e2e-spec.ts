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
import { seedArtworkWithContract, seedOpenRfq, SEED_CONTRACT_ADDR, type QueryFn } from '../shared/seed-marketplace';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const CONTRACT_ADDR = SEED_CONTRACT_ADDR;

interface BeginResponse { options: { challenge: string } }
interface FinishResponse { accessToken: string; contractAddress: string }
interface RegisteredUser extends FinishResponse { passkey: SoftwarePasskey }
interface QuoteResponse {
  id: string; rfqId: string; fractionContractId: string;
  fractionCount: string; pricePerFractionStroops: string; validUntil: string;
  validUntilCapped?: boolean; status: string; createdAt: string;
}
interface ErrorResponse { errorCode: string; requiredCount?: string; freeBalance?: string }

const future = (h = 48): string => new Date(Date.now() + h * 3_600_000).toISOString();

describe('Marketplace Quote submission (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let server: object;
  const q: QueryFn = (text: string, params: unknown[] = []) => ds.query(text, params);
  const relayer = new FakeRelayerService();
  const fractionRead = new FakeFractionReadService();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .overrideProvider(FRACTION_READ_SERVICE)
      .useValue(fractionRead)
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
    fractionRead.reset();
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

  const key = () => `${randomUUID().slice(0, 8)}-q`;
  const url = (rfqId: string) => `/api/v1/marketplace/rfqs/${rfqId}/quotes`;
  function post(token: string, rfqId: string, idk: string, body: object) {
    return request(server).post(url(rfqId)).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idk).send(body);
  }
  const validBody = (patch: object = {}) => ({
    pricePerFractionStroops: '150000000',
    fractionCount: 25,
    validUntil: future(24),
    ...patch,
  });

  // ── happy path ──────────────────────────────────────────────────────────
  it('AC-1: a whitelisted holder with enough free balance creates an open quote (201)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-happy@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');

    const body = (await post(holder.accessToken, rfqId, key(), validBody()).expect(201)).body as QuoteResponse;
    expect(body.status).toBe('open');
    expect(body.rfqId).toBe(rfqId);
    expect(body.fractionCount).toBe('25');
    expect(body.validUntilCapped).toBeUndefined();

    const rows = await ds.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM rfq_quotes WHERE rfq_id=$1`, [rfqId]);
    expect(rows[0].n).toBe('1');
  });

  // ── AC-2: insufficient free balance ───────────────────────────────────────
  it('AC-2: insufficient free balance → 422 QUOTE_INSUFFICIENT_FREE_BALANCE with amounts', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-poor@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '5');

    const res = await post(holder.accessToken, rfqId, key(), validBody({ fractionCount: 10 })).expect(422);
    const err = res.body as ErrorResponse;
    expect(err.errorCode).toBe('QUOTE_INSUFFICIENT_FREE_BALANCE');
    expect(err.requiredCount).toBe('10');
    expect(err.freeBalance).toBe('5');
    const rows = await ds.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM rfq_quotes WHERE rfq_id=$1`, [rfqId]);
    expect(rows[0].n).toBe('0');
  });

  // ── AC-3: validity capped ─────────────────────────────────────────────────
  it('AC-3: validUntil beyond the RFQ expiry is silently capped (validUntilCapped:true)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { expiresAt: future(1) }); // RFQ expires in 1h
    const holder = await registerUser('q-cap@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');

    const body = (await post(holder.accessToken, rfqId, key(), validBody({ validUntil: future(48) })).expect(201)).body as QuoteResponse;
    expect(body.validUntilCapped).toBe(true);
    // capped to ~1h out, not 48h
    expect(new Date(body.validUntil).getTime()).toBeLessThan(Date.now() + 2 * 3_600_000);
  });

  // ── chain read fail-closed ────────────────────────────────────────────────
  it('a chain-read failure → 503 QUOTE_BALANCE_UNAVAILABLE, no quote created', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-503@example.com');
    fractionRead.error = new Error('rpc down');

    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(503);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_BALANCE_UNAVAILABLE');
    const rows = await ds.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM rfq_quotes WHERE rfq_id=$1`, [rfqId]);
    expect(rows[0].n).toBe('0');
  });

  // ── state gates ───────────────────────────────────────────────────────────
  it('a non-whitelisted holder is blocked 403 QUOTE_NOT_WHITELISTED', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-notkyc@example.com', false);
    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(403);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_NOT_WHITELISTED');
  });

  it('an unknown RFQ → 404 QUOTE_RFQ_NOT_FOUND', async () => {
    const holder = await registerUser('q-norfq@example.com');
    const res = await post(holder.accessToken, randomUUID(), key(), validBody()).expect(404);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_RFQ_NOT_FOUND');
  });

  it('a non-open RFQ → 422 QUOTE_RFQ_NOT_OPEN', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { status: 'filled' });
    const holder = await registerUser('q-notopen@example.com');
    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_RFQ_NOT_OPEN');
  });

  it('an expired RFQ → 422 QUOTE_RFQ_EXPIRED', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, {
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    const holder = await registerUser('q-expired@example.com');
    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_RFQ_EXPIRED');
  });

  it('quoting your own RFQ → 422 QUOTE_ON_OWN_RFQ', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const holder = await registerUser('q-self@example.com');
    const [{ user_id: holderSub }] = await ds.query<{ user_id: string }[]>(
      `SELECT user_id FROM wallets WHERE contract_address=$1`, [holder.contractAddress],
    );
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: holderSub });
    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_ON_OWN_RFQ');
  });

  it('a second open quote on the same RFQ → 409 QUOTE_ALREADY_OPEN', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-dup@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');
    await post(holder.accessToken, rfqId, key(), validBody()).expect(201);
    const res = await post(holder.accessToken, rfqId, key(), validBody()).expect(409);
    expect((res.body as ErrorResponse).errorCode).toBe('QUOTE_ALREADY_OPEN');
  });

  it('re-quote succeeds after the holder own quote on the RFQ has lapsed (TOV-175 #370)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-requote@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');
    const [{ user_id: holderSub }] = await ds.query<{ user_id: string }[]>(
      `SELECT user_id FROM wallets WHERE contract_address=$1`, [holder.contractAddress],
    );
    // Seed a lapsed (valid_until in the past) but still-open quote for this holder on this RFQ.
    await ds.query(
      `INSERT INTO rfq_quotes (rfq_id, holder_sub, fraction_contract_id, fraction_count,
         price_per_fraction_stroops, valid_until, status, idempotency_key_hash, created_at)
       VALUES ($1,$2,$3,'5','150000000',$4,'open',$5,$6)`,
      [
        rfqId, holderSub, contractId,
        new Date(Date.now() - 1 * 3_600_000).toISOString(),
        Buffer.alloc(32, 7),
        new Date(Date.now() - 3 * 3_600_000).toISOString(),
      ],
    );
    // A fresh submit must succeed: the lapsed quote is reaped to 'expired' and the slot frees.
    const body = (await post(holder.accessToken, rfqId, key(), validBody()).expect(201)).body as QuoteResponse;
    expect(body.status).toBe('open');
    const rows = await ds.query<{ status: string }[]>(
      `SELECT status FROM rfq_quotes WHERE rfq_id=$1 AND holder_sub=$2 ORDER BY created_at`, [rfqId, holderSub],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(['expired', 'open']);
  });

  // ── auth / header / DTO edges ─────────────────────────────────────────────
  it('rejects a submit without an Idempotency-Key (400)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-noidem@example.com');
    await request(server).post(url(rfqId)).set('Authorization', `Bearer ${holder.accessToken}`).send(validBody()).expect(400);
  });

  it('rejects an unauthenticated submit (401)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    await request(server).post(url(rfqId)).set('Idempotency-Key', key()).send(validBody()).expect(401);
  });

  it('rejects an offset-less validUntil (400)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-badtz@example.com');
    await post(holder.accessToken, rfqId, key(), validBody({ validUntil: '2027-01-01T00:00:00' })).expect(400);
  });

  // ── idempotency ───────────────────────────────────────────────────────────
  it('replays the same 201 for a repeated key + body, writing exactly one row', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-replay@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');
    const idk = key();
    const body = validBody();
    const first = (await post(holder.accessToken, rfqId, idk, body).expect(201)).body as QuoteResponse;
    const second = (await post(holder.accessToken, rfqId, idk, body).expect(201)).body as QuoteResponse;
    expect(second.id).toBe(first.id);
    const rows = await ds.query<{ n: string }[]>(`SELECT count(*)::text AS n FROM rfq_quotes WHERE rfq_id=$1`, [rfqId]);
    expect(rows[0].n).toBe('1');
  });

  it('a reused key with a different body → 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = await registerUser('q-mismatch@example.com');
    fractionRead.balances.set(CONTRACT_ADDR, '1000');
    const idk = key();
    await post(holder.accessToken, rfqId, idk, validBody()).expect(201);
    const res = await post(holder.accessToken, rfqId, idk, validBody({ fractionCount: 50 })).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });
});
