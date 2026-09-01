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
import { insertOffering } from '../shared/seed-offering';
import { FakeRelayerService } from '../shared/fake-relayer';
import {
  createSoftwarePasskey,
  buildAttestation,
  signAssertion,
  type SoftwarePasskey,
} from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ESCROW_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

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
interface PrepareResponse {
  txXdr: string;
  challenge: string;
  escrowAmountStroops: string;
  escrowContract: string;
}
interface BidResponse {
  id: string;
  status: string;
  chainBidId: number | null;
  escrowTxHash: string | null;
  escrowAmountStroops: string;
}
interface ErrorResponse {
  errorCode: string;
  requiredStroops?: string;
  availableStroops?: string;
}

describe('Offering bid submission (e2e)', () => {
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

  /** Seed a deployed artwork + an OPENED offering (band [50M,150M], window open now). Returns its id. */
  async function seedOpenedOffering(): Promise<string> {
    const users = await ds.query<{ id: string }[]>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
    );
    const artworks = await ds.query<{ id: string }[]>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`,
      [users[0].id],
    );
    const contracts = await ds.query<{ id: string }[]>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730) RETURNING id`,
      [
        artworks[0].id,
        ESCROW_ADDR,
        '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd',
        'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      ],
    );
    return insertOffering((t: string, p?: unknown[]) => ds.query(t, p), {
      artworkId: artworks[0].id,
      fractionContractId: contracts[0].id,
      status: 'opened',
      windowOpenAt: '2020-01-01T00:00:00Z',
      windowCloseAt: '2099-01-08T00:00:00Z',
      createdByAdminSub: randomUUID(),
      escrowDeployStatus: 'deployed',
      escrowContractAddress: ESCROW_ADDR,
    });
  }

  const key = () => `${randomUUID().slice(0, 8)}-bid`;

  // NOT async — returns the chainable supertest request so callers can `.expect(...)`.
  function prepare(token: string, offeringId: string, idk: string, price: string, count: number) {
    return request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/prepare`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idk)
      .send({ price, count });
  }

  // ── AC-1: valid bid accepted + escrowed ───────────────────────────────────────────────────────────
  it('AC-1: prepare -> sign -> submit -> escrowed (1,000M stroops)', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-happy@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000'); // fund the bidder

    const idk = key();
    const prep = await prepare(user.accessToken, offeringId, idk, '100000000', 10).expect(200);
    const prepBody = prep.body as PrepareResponse;
    expect(prepBody.escrowAmountStroops).toBe('1000000000');
    expect(prepBody.escrowContract).toBe(ESCROW_ADDR);

    const assertion = signAssertion({ passkey: user.passkey, challenge: prepBody.challenge, rpId: RP_ID, origin: ORIGIN });
    const submit = await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idk)
      .send({ price: '100000000', count: 10, txXdr: prepBody.txXdr, ...assertion })
      .expect(201);
    expect((submit.body as BidResponse).status).toBe('submitted');
    expect((submit.body as BidResponse).escrowAmountStroops).toBe('1000000000');

    // The async worker escrows via the fake relayer — poll /bids/me until it leaves 'submitted'.
    let me!: BidResponse;
    for (let i = 0; i < 40; i++) {
      const res = await request(server)
        .get(`/api/v1/offerings/${offeringId}/bids/me`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      me = res.body as BidResponse;
      if (me.status !== 'submitted') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(me.status).toBe('escrowed');
    expect(me.chainBidId).toBeGreaterThan(0);
    expect(me.escrowTxHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── AC-2: below band rejected ─────────────────────────────────────────────────────────────────────
  it('AC-2: a bid below the band is rejected 422 BID_BELOW_LOW_PRICE', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-lowball@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000');
    const res = await prepare(user.accessToken, offeringId, key(), '40000000', 10).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_BELOW_LOW_PRICE');
  });

  // ── AC-3: non-whitelisted blocked ─────────────────────────────────────────────────────────────────
  it('AC-3: a non-whitelisted collector is blocked 403 BID_NOT_WHITELISTED', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-notkyc@example.com', false); // NOT whitelisted
    relayer.setHolding(user.contractAddress, USDC, '100000000000');
    const res = await prepare(user.accessToken, offeringId, key(), '100000000', 10).expect(403);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_NOT_WHITELISTED');
  });

  // ── edge: expired signature → 422 BID_CHALLENGE_EXPIRED (fail fast, no row) ───────────────────────
  it('rejects a submit whose signature expired 422 BID_CHALLENGE_EXPIRED, writing no bid', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-expired@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100000000000');
    const idk = key();
    const prep = (await prepare(user.accessToken, offeringId, idk, '100000000', 10).expect(200)).body as PrepareResponse;
    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });

    relayer.expireNextBid(); // simulate the challenge/tx expiring before submit
    const res = await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idk)
      .send({ price: '100000000', count: 10, txXdr: prep.txXdr, ...assertion })
      .expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_CHALLENGE_EXPIRED');

    // No bid was recorded, and the key was released → a fresh re-prepare+submit can still succeed.
    const me = await request(server)
      .get(`/api/v1/offerings/${offeringId}/bids/me`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect((me.body as { id?: string }).id).toBeUndefined(); // no active bid recorded
  });

  // ── edge: insufficient balance, missing idem key, unauthenticated ─────────────────────────────────
  it('rejects an under-funded bid 422 BID_INSUFFICIENT_BALANCE with amounts', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-poor@example.com');
    relayer.setHolding(user.contractAddress, USDC, '100'); // far below price*count
    const res = await prepare(user.accessToken, offeringId, key(), '100000000', 10).expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_INSUFFICIENT_BALANCE');
    expect((res.body as ErrorResponse).requiredStroops).toBe('1000000000');
    expect((res.body as ErrorResponse).availableStroops).toBe('100');
  });

  it('rejects prepare without an Idempotency-Key (400)', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('bid-noidem@example.com');
    await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/prepare`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ price: '100000000', count: 10 })
      .expect(400);
  });

  it('rejects an unauthenticated prepare (401)', async () => {
    const offeringId = await seedOpenedOffering();
    await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/prepare`)
      .set('Idempotency-Key', key())
      .send({ price: '100000000', count: 10 })
      .expect(401);
  });
});
