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
interface PrepareCancelResponse {
  txXdr: string;
  challenge: string;
  escrowContract: string;
  bidId: number;
}
interface BidResponse {
  id: string;
  status: string;
  chainBidId: number | null;
  refundTxHash: string | null;
  canceledAt: string | null;
}
interface ErrorResponse {
  errorCode: string;
}

/**
 * TOV-158 (FR-05.04) USDC escrow cancel + refund — e2e. Drives the full passkey flow: register → submit a bid
 * → poll to escrowed → cancel/prepare → sign → cancel (202) → poll to canceled. Mirrors the TOV-156 harness
 * (no-op throttler + FakeRelayerService, which runs the REAL cancel verifier offline).
 */
describe('Offering bid cancel (e2e)', () => {
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
    const user = { ...(finish.body as FinishResponse), passkey };
    await setKyc(user.contractAddress, 'whitelisted');
    return user;
  }

  async function setKyc(contractAddress: string, status: string): Promise<void> {
    await ds.query(
      `UPDATE users SET kyc_status=$2 WHERE id = (SELECT user_id FROM wallets WHERE contract_address=$1)`,
      [contractAddress, status],
    );
  }

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

  const key = () => `${randomUUID().slice(0, 8)}-c`;

  /** Full submit flow → returns once the bid has escrowed (polls /bids/me). */
  async function escrowABid(user: RegisteredUser, offeringId: string): Promise<void> {
    relayer.setHolding(user.contractAddress, USDC, '100000000000');
    const idk = key();
    const prep = (
      await request(server)
        .post(`/api/v1/offerings/${offeringId}/bids/prepare`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .set('Idempotency-Key', idk)
        .send({ price: '100000000', count: 10 })
        .expect(200)
    ).body as { txXdr: string; challenge: string };
    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idk)
      .send({ price: '100000000', count: 10, txXdr: prep.txXdr, ...assertion })
      .expect(201);
    for (let i = 0; i < 40; i++) {
      const me = (
        await request(server)
          .get(`/api/v1/offerings/${offeringId}/bids/me`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200)
      ).body as BidResponse;
      if (me.status === 'escrowed') return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('bid did not reach escrowed');
  }

  function prepareCancel(token: string, offeringId: string) {
    return request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/cancel/prepare`)
      .set('Authorization', `Bearer ${token}`);
  }

  // ── AC-1: cancel refunds USDC → canceled ────────────────────────────────────────────────────────────
  it('AC-1: escrowed -> cancel/prepare -> sign -> cancel(202) -> canceled with refund hash', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-happy@example.com');
    await escrowABid(user, offeringId);

    const prep = (await prepareCancel(user.accessToken, offeringId).expect(200)).body as PrepareCancelResponse;
    expect(prep.escrowContract).toBe(ESCROW_ADDR);
    expect(prep.bidId).toBeGreaterThan(0);

    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    const cancel = await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', key())
      .send({ txXdr: prep.txXdr, ...assertion })
      .expect(202);
    expect((cancel.body as BidResponse).status).toBe('canceling');

    let me!: BidResponse;
    for (let i = 0; i < 40; i++) {
      me = (
        await request(server)
          .get(`/api/v1/offerings/${offeringId}/bids/me`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200)
      ).body as BidResponse;
      if (me.status !== 'canceling') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(me.status).toBe('canceled');
    expect(me.refundTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(me.canceledAt).not.toBeNull();
  });

  // ── AC-8: a canceled bid frees the slot → the collector can bid again ────────────────────────────────
  it('AC-8: after canceled the slot frees, so a new bid can be submitted', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-rebid@example.com');
    await escrowABid(user, offeringId);
    const prep = (await prepareCancel(user.accessToken, offeringId).expect(200)).body as PrepareCancelResponse;
    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', key())
      .send({ txXdr: prep.txXdr, ...assertion })
      .expect(202);
    for (let i = 0; i < 40; i++) {
      const me = (
        await request(server)
          .get(`/api/v1/offerings/${offeringId}/bids/me`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200)
      ).body as BidResponse;
      if (me.status === 'canceled') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    // The slot is free — a fresh escrow succeeds (would 409 BID_ALREADY_ACTIVE if the slot were held).
    await escrowABid(user, offeringId);
  });

  // ── AC-6: cancel is NOT whitelist-gated (de-whitelisted owner can still reclaim) ─────────────────────
  it('AC-6: a de-whitelisted (frozen) owner can still cancel and get refunded', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-frozen@example.com');
    await escrowABid(user, offeringId);
    await setKyc(user.contractAddress, 'frozen'); // de-whitelist AFTER bidding

    const prep = (await prepareCancel(user.accessToken, offeringId).expect(200)).body as PrepareCancelResponse;
    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', key())
      .send({ txXdr: prep.txXdr, ...assertion })
      .expect(202);
  });

  // ── AC-5: no active bid → 404 BID_NOT_FOUND (no existence oracle) ────────────────────────────────────
  it('AC-5: cancel/prepare with no active bid → 404 BID_NOT_FOUND', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-nobid@example.com');
    const res = await prepareCancel(user.accessToken, offeringId).expect(404);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_NOT_FOUND');
  });

  // ── AC-4: offering not opened → 409 OFFERING_NOT_OPEN ───────────────────────────────────────────────
  it('AC-4: cancel/prepare on a non-opened offering → 409 OFFERING_NOT_OPEN', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-closed@example.com');
    await escrowABid(user, offeringId);
    await ds.query(`UPDATE offerings SET status='subscribed' WHERE id=$1`, [offeringId]);
    const res = await prepareCancel(user.accessToken, offeringId).expect(409);
    expect((res.body as ErrorResponse).errorCode).toBe('OFFERING_NOT_OPEN');
  });

  // ── AC-7: expired signature at cancel → 422, bid stays escrowed ─────────────────────────────────────
  it('AC-7: an expired cancel signature → 422 BID_CHALLENGE_EXPIRED, bid stays escrowed', async () => {
    const offeringId = await seedOpenedOffering();
    const user = await registerUser('cancel-expired@example.com');
    await escrowABid(user, offeringId);
    const prep = (await prepareCancel(user.accessToken, offeringId).expect(200)).body as PrepareCancelResponse;
    const assertion = signAssertion({ passkey: user.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });

    relayer.expireNextBid(); // the fn-agnostic expiry pre-check rejects
    const res = await request(server)
      .post(`/api/v1/offerings/${offeringId}/bids/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', key())
      .send({ txXdr: prep.txXdr, ...assertion })
      .expect(422);
    expect((res.body as ErrorResponse).errorCode).toBe('BID_CHALLENGE_EXPIRED');

    // The bid was untouched — still escrowed (a re-cancel is possible).
    const me = (
      await request(server)
        .get(`/api/v1/offerings/${offeringId}/bids/me`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200)
    ).body as BidResponse;
    expect(me.status).toBe('escrowed');
  });
});
