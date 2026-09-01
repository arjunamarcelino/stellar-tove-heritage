import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { StrKey, Networks } from '@stellar/stellar-sdk';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RELAYER_SERVICE } from '../../src/modules/relayer/relayer.service.interface';
import { FRACTION_READ_SERVICE } from '../../src/modules/fractionalization/fraction-read.service.interface';
import { marketplaceSettlementConfig } from '../../src/config/marketplace-settlement.config';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { FakeFractionReadService } from '../shared/fake-fraction-read';
import { createSoftwarePasskey, buildAttestation, signAssertion, type SoftwarePasskey } from '../shared/webauthn-authenticator';
import { seedArtworkWithContract, seedOpenRfq, seedQuote, SEED_CONTRACT_ADDR, type QueryFn } from '../shared/seed-marketplace';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const cid = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));
const SETTLEMENT_CFG = {
  rpcUrl: 'http://localhost', networkPassphrase: Networks.TESTNET, settlerAddress: cid(1), usdcAddress: cid(2),
  readTimeoutMs: 5000, acceptSigValidityLedgers: 120, settleGraceMs: 120000,
  reconcileEnabled: false, reconcileCron: '* * * * *', reconcileGraceMs: 180000, reconcileBatch: 100,
};

interface BeginResponse { options: { challenge: string } }
interface FinishResponse { accessToken: string; contractAddress: string }
interface RegisteredUser extends FinishResponse { passkey: SoftwarePasskey; userId: string }
interface PrepareResp { challenge: string; sellerAuthEntryXdr: string; trade: { count: string; grossStroops: string } }

describe('Marketplace seller-authorize (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let server: object;
  const q: QueryFn = (text: string, params: unknown[] = []) => ds.query(text, params);
  const relayer = new FakeRelayerService();
  const fractionRead = new FakeFractionReadService();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage).useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE).useValue(relayer)
      .overrideProvider(FRACTION_READ_SERVICE).useValue(fractionRead)
      .overrideProvider(marketplaceSettlementConfig.KEY).useValue(SETTLEMENT_CFG)
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
    for (const entity of ds.entityMetadatas) await ds.getRepository(entity.name).query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
    fractionRead.reset();
    fractionRead.balances.set(SEED_CONTRACT_ADDR, '1000');
  });

  async function registerUser(email: string, whitelist = true): Promise<RegisteredUser> {
    const passkey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({ passkey, challenge: (begin.body as BeginResponse).options.challenge, rpId: RP_ID, origin: ORIGIN });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const body = finish.body as FinishResponse;
    const rows = await q<{ user_id: string }>(`SELECT user_id FROM wallets WHERE contract_address=$1`, [body.contractAddress]);
    if (whitelist) await q(`UPDATE users SET kyc_status='whitelisted' WHERE id=$1`, [rows[0].user_id]);
    return { ...body, passkey, userId: rows[0].user_id };
  }

  const authorizeUrl = (rfqId: string, quoteId: string) => `/api/v1/marketplace/rfqs/${rfqId}/quotes/${quoteId}/authorize`;

  it('seller authorizes a quote → it becomes acceptable in the buyer RFQ-detail read', async () => {
    const buyer = await registerUser('auth-buyer@example.com');
    const seller = await registerUser('auth-seller@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const quoteId = await seedQuote(q, rfqId, contractId, { holderSub: seller.userId, count: '5', price: '20' });

    // prepare → sign → authorize
    const prep = (await request(server)
      .post(`${authorizeUrl(rfqId, quoteId)}/prepare`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200)).body as PrepareResp;
    expect(prep.trade).toMatchObject({ count: '5', grossStroops: '100' });

    const a = signAssertion({ passkey: seller.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    await request(server)
      .post(authorizeUrl(rfqId, quoteId))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ sellerAuthEntryXdr: prep.sellerAuthEntryXdr, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, signature: a.signature })
      .expect(200);

    // The buyer's RFQ-detail read now shows the quote acceptable.
    const detail = (await request(server).get(`/api/v1/marketplace/rfqs/${rfqId}`).set('Authorization', `Bearer ${buyer.accessToken}`).expect(200)).body as { quotes: Array<{ quoteId: string; acceptable: boolean }> };
    expect(detail.quotes.find((x) => x.quoteId === quoteId)?.acceptable).toBe(true);

    // The stored authorization is never exposed.
    expect(JSON.stringify(detail)).not.toMatch(/seller_auth_entry|sellerAuthEntry/);
  });

  it('a non-seller cannot authorize (404 QUOTE_NOT_FOUND, no oracle)', async () => {
    const buyer = await registerUser('auth-owner2@example.com');
    const seller = await registerUser('auth-seller2@example.com');
    const stranger = await registerUser('auth-stranger@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const quoteId = await seedQuote(q, rfqId, contractId, { holderSub: seller.userId });
    const res = await request(server).post(`${authorizeUrl(rfqId, quoteId)}/prepare`).set('Authorization', `Bearer ${stranger.accessToken}`).expect(404);
    expect((res.body as { errorCode: string }).errorCode).toBe('QUOTE_NOT_FOUND');
  });

  it('an over-authorization (balance < count) is rejected 422 QUOTE_OVER_AUTHORIZED', async () => {
    const buyer = await registerUser('auth-buyer3@example.com');
    const seller = await registerUser('auth-seller3@example.com');
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const quoteId = await seedQuote(q, rfqId, contractId, { holderSub: seller.userId, count: '5000' });
    fractionRead.balances.set(SEED_CONTRACT_ADDR, '10'); // < 5000
    const res = await request(server).post(`${authorizeUrl(rfqId, quoteId)}/prepare`).set('Authorization', `Bearer ${seller.accessToken}`).expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('QUOTE_OVER_AUTHORIZED');
  });

  it('unauthenticated → 401', async () => {
    await request(server).post(`${authorizeUrl(randomUUID(), randomUUID())}/prepare`).expect(401);
  });
});
