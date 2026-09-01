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
import { MARKETPLACE_SETTLER_READ_SERVICE } from '../../src/modules/marketplace/settlement/marketplace-settler-read.service.interface';
import { marketplaceSettlementConfig } from '../../src/config/marketplace-settlement.config';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { FakeFractionReadService } from '../shared/fake-fraction-read';
import { FakeMarketplaceSettlerRead } from '../shared/fake-marketplace-settler-read';
import { createSoftwarePasskey, buildAttestation, signAssertion, type SoftwarePasskey } from '../shared/webauthn-authenticator';
import { seedArtworkWithContract, seedOpenRfq, seedQuote, SEED_CONTRACT_ADDR, type QueryFn } from '../shared/seed-marketplace';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const cid = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));
const USDC = cid(2);
const CFG = {
  rpcUrl: 'http://localhost', networkPassphrase: Networks.TESTNET, settlerAddress: cid(1), usdcAddress: USDC,
  readTimeoutMs: 5000, acceptSigValidityLedgers: 120, settleGraceMs: 120000,
  reconcileEnabled: false, reconcileCron: '* * * * *', reconcileGraceMs: 180000, reconcileBatch: 100,
};

interface BeginResp { options: { challenge: string } }
interface FinishResp { accessToken: string; contractAddress: string }
interface User extends FinishResp { passkey: SoftwarePasskey; userId: string }
interface PrepareResp { challenge: string; sellerAuthEntryXdr?: string; buyerAuthEntryXdr?: string }
interface Trade { status: string; failureReason: string | null; txHash: string | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Marketplace buyer-accept + atomic settlement (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let server: object;
  const q: QueryFn = (text: string, params: unknown[] = []) => ds.query(text, params);
  const relayer = new FakeRelayerService();
  const fractionRead = new FakeFractionReadService();
  const settlerRead = new FakeMarketplaceSettlerRead();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage).useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE).useValue(relayer)
      .overrideProvider(FRACTION_READ_SERVICE).useValue(fractionRead)
      .overrideProvider(MARKETPLACE_SETTLER_READ_SERVICE).useValue(settlerRead)
      .overrideProvider(marketplaceSettlementConfig.KEY).useValue(CFG)
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
    settlerRead.reset();
  });

  async function registerUser(email: string): Promise<User> {
    const passkey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({ passkey, challenge: (begin.body as BeginResp).options.challenge, rpId: RP_ID, origin: ORIGIN });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const body = finish.body as FinishResp;
    const rows = await q<{ user_id: string }>(`SELECT user_id FROM wallets WHERE contract_address=$1`, [body.contractAddress]);
    await q(`UPDATE users SET kyc_status='whitelisted' WHERE id=$1`, [rows[0].user_id]);
    return { ...body, passkey, userId: rows[0].user_id };
  }

  /** Register buyer+seller, seed rfq+quote, and fully authorize the quote (seller leg). Returns ids + users. */
  async function setupAuthorized(count = '5', price = '20') {
    const buyer = await registerUser(`accept-buyer-${randomUUID().slice(0, 6)}@e.com`);
    const seller = await registerUser(`accept-seller-${randomUUID().slice(0, 6)}@e.com`);
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const quoteId = await seedQuote(q, rfqId, contractId, { holderSub: seller.userId, count, price });
    // seller authorize
    const aUrl = `/api/v1/marketplace/rfqs/${rfqId}/quotes/${quoteId}/authorize`;
    const prep = (await request(server).post(`${aUrl}/prepare`).set('Authorization', `Bearer ${seller.accessToken}`).expect(200)).body as PrepareResp;
    const sa = signAssertion({ passkey: seller.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    await request(server).post(aUrl).set('Authorization', `Bearer ${seller.accessToken}`).set('Idempotency-Key', randomUUID())
      .send({ sellerAuthEntryXdr: prep.sellerAuthEntryXdr, authenticatorData: sa.authenticatorData, clientDataJSON: sa.clientDataJSON, signature: sa.signature }).expect(200);
    // fund the buyer's USDC = gross
    relayer.setHolding(buyer.contractAddress, USDC, (BigInt(count) * BigInt(price)).toString());
    return { buyer, seller, rfqId, quoteId, contractId };
  }

  async function acceptSubmit(buyer: User, rfqId: string, quoteId: string) {
    const url = `/api/v1/marketplace/rfqs/${rfqId}/accept`;
    const prep = (await request(server).post(`${url}/prepare`).set('Authorization', `Bearer ${buyer.accessToken}`).send({ quoteId }).expect(200)).body as PrepareResp;
    const ba = signAssertion({ passkey: buyer.passkey, challenge: prep.challenge, rpId: RP_ID, origin: ORIGIN });
    return request(server).post(url).set('Authorization', `Bearer ${buyer.accessToken}`).set('Idempotency-Key', randomUUID())
      .send({ quoteId, buyerAuthEntryXdr: prep.buyerAuthEntryXdr, authenticatorData: ba.authenticatorData, clientDataJSON: ba.clientDataJSON, signature: ba.signature })
      .then((r) => r); // resolve the supertest Test → response
  }

  async function pollTrade(buyer: User, rfqId: string): Promise<Trade> {
    for (let i = 0; i < 40; i++) {
      const res = await request(server).get(`/api/v1/marketplace/rfqs/${rfqId}/accept/me`).set('Authorization', `Bearer ${buyer.accessToken}`).expect(200);
      const t = res.body as Trade;
      if (t.status !== 'pending') return t;
      await sleep(150);
    }
    throw new Error('trade did not reach a terminal state in time');
  }

  it('AC1: authorize → accept → worker settles → rfq filled, quote accepted, rivals superseded', async () => {
    const { buyer, rfqId, quoteId, contractId } = await setupAuthorized();
    // A rival open quote (DIFFERENT holder — one open quote per (rfq, holder)) — superseded at settle.
    const rival = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID() });

    expect((await acceptSubmit(buyer, rfqId, quoteId)).status).toBe(202);
    const trade = await pollTrade(buyer, rfqId);
    expect(trade.status).toBe('settled');
    expect(trade.txHash).not.toBeNull();

    const [rfq] = await q<{ status: string }>(`SELECT status FROM rfqs WHERE id=$1`, [rfqId]);
    const [won] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [quoteId]);
    const [lost] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [rival]);
    expect(rfq.status).toBe('filled');
    expect(won.status).toBe('accepted');
    expect(lost.status).toBe('superseded');

    // #390: money-adjacent quote transitions leave an audit trail (atomic with the settle).
    const kinds = (await q<{ kind: string }>(
      `SELECT kind FROM internal_audit_log WHERE subject_id IN ($1,$2) ORDER BY kind`,
      [quoteId, rival],
    )).map((r) => r.kind);
    expect(kinds).toContain('quote.accepted');
    expect(kinds).toContain('quote.superseded');
  });

  it('AC2: a seller-balance revert (#100) → trade failed, quote expired (reason), RFQ stays open', async () => {
    const { buyer, rfqId, quoteId } = await setupAuthorized();
    relayer.revertNextAcceptSettle(100); // the worker's submitSignedAcceptQuote → REVERTED{100}

    expect((await acceptSubmit(buyer, rfqId, quoteId)).status).toBe(202);
    const trade = await pollTrade(buyer, rfqId);
    expect(trade.status).toBe('failed');
    expect(trade.failureReason).toBe('seller_balance_insufficient');

    const [rfq] = await q<{ status: string }>(`SELECT status FROM rfqs WHERE id=$1`, [rfqId]);
    const [quote] = await q<{ status: string; status_reason: string }>(`SELECT status, status_reason FROM rfq_quotes WHERE id=$1`, [quoteId]);
    expect(rfq.status).toBe('open'); // stays open — the buyer can accept another quote
    expect(quote.status).toBe('expired');
    expect(quote.status_reason).toBe('seller_balance_insufficient');
  });

  it('accepting an un-authorized quote → 422 ACCEPT_QUOTE_NOT_AUTHORIZED', async () => {
    const buyer = await registerUser(`accept-b2-${randomUUID().slice(0, 6)}@e.com`);
    const seller = await registerUser(`accept-s2-${randomUUID().slice(0, 6)}@e.com`);
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId, { collectorSub: buyer.userId });
    const quoteId = await seedQuote(q, rfqId, contractId, { holderSub: seller.userId }); // NOT authorized
    relayer.setHolding(buyer.contractAddress, USDC, '1000000');
    const res = await request(server).post(`/api/v1/marketplace/rfqs/${rfqId}/accept/prepare`).set('Authorization', `Bearer ${buyer.accessToken}`).send({ quoteId }).expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('ACCEPT_QUOTE_NOT_AUTHORIZED');
  });

  it('a non-buyer cannot accept → 403 ACCEPT_NOT_RFQ_BUYER', async () => {
    const { rfqId, quoteId } = await setupAuthorized();
    const stranger = await registerUser(`accept-stranger-${randomUUID().slice(0, 6)}@e.com`);
    const res = await request(server).post(`/api/v1/marketplace/rfqs/${rfqId}/accept/prepare`).set('Authorization', `Bearer ${stranger.accessToken}`).send({ quoteId }).expect(403);
    expect((res.body as { errorCode: string }).errorCode).toBe('ACCEPT_NOT_RFQ_BUYER');
  });
});
