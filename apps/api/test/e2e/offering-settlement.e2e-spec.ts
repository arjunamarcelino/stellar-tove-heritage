import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import { OFFERING_ESCROW_SERVICE } from '../../src/modules/offerings/escrow/offering-escrow.service.interface';
import { FakeOfferingEscrowService } from '../shared/fake-offering-escrow.service';
import { OfferingSettleProcessor } from '../../src/modules/offerings/settle/offering-settle.processor';

/**
 * TOV-160 uniform-price clearing + settlement (FR-05.05). GET /offerings/:id/clearing-preview + POST
 * /offerings/:id/settle. Requires the local `tove_test` DB (`yarn db:test:setup`) + Redis. The on-chain
 * escrow is faked (`OFFERING_ESCROW_SERVICE` override); the settle worker is driven directly for
 * determinism (the enqueued BullMQ job also runs but no-ops once settled).
 */
interface PreviewBody {
  fullySubscribed: boolean;
  clearingPriceStroops: string | null;
  allocations: Array<{ bidId: number; allocatedCount: string }>;
  errorCode?: string;
}
interface DetailBody {
  id: string;
  status: string;
  settleFailedAt: string | null;
  settlementPhase: string | null;
  errorCode?: string;
}

describe('Offering settlement (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const fakeEscrow = new FakeOfferingEscrowService();

  const SUPERADMIN_ID = '00000000-0000-4000-8000-000000160001';
  const password = 'SuperAdmin1!@#';
  const email = 'off160-admin@example.com';
  const ARTIST_ID = '00000000-0000-4000-8000-000000160010';
  const ARTWORK_ID = '00000000-0000-4000-8000-000000160011';
  const FC_ID = '00000000-0000-4000-8000-000000160012';
  const OFFERING_ID = '00000000-0000-4000-8000-000000160020';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const TOKEN_ADDRESS = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const runId = randomUUID().slice(0, 8);

  const q = (t: string, p: unknown[] = []): Promise<unknown[]> => dataSource.query(t, p);

  async function seedAdmin(): Promise<void> {
    const hash = await bcrypt.hash(password, 12);
    await q(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active") VALUES ($1,$2,$3,'superadmin',true) ON CONFLICT ("id") DO NOTHING`,
      [SUPERADMIN_ID, email, hash],
    );
  }

  /** Seed an `opened` offering with a CLOSED window + a deployed escrow, `public_float`. */
  async function seedOffering(publicFloat: string, escrowAddress: string): Promise<void> {
    await q(`INSERT INTO "users" ("id","is_active") VALUES ($1,true) ON CONFLICT ("id") DO NOTHING`, [ARTIST_ID]);
    await q(`INSERT INTO "artworks" ("id","status","artist_user_id","title") VALUES ($1,'fractionalized',$2,'M05') ON CONFLICT ("id") DO NOTHING`, [ARTWORK_ID, ARTIST_ID]);
    await q(
      `INSERT INTO "fraction_contracts" ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol","artist_address","total_supply","artist_retention_pct","treasury_retention_pct","artist_retention_amount","treasury_retention_amount","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deployed',$3,$4,'M05','M5T',$5,'1000000000',10,5,'100000000','50000000',365,730) ON CONFLICT ("id") DO NOTHING`,
      [FC_ID, ARTWORK_ID, TOKEN_ADDRESS, 'a'.repeat(64), ARTIST_ADDRESS],
    );
    await insertOffering(q, {
      id: OFFERING_ID,
      artworkId: ARTWORK_ID,
      fractionContractId: FC_ID,
      status: 'opened',
      lowPriceStroops: '1',
      highPriceStroops: '1000000000',
      publicFloat,
      totalSupplyStroops: publicFloat, // total = float, retentions 0 (decomposition-consistent)
      createdByAdminSub: SUPERADMIN_ID,
      escrowDeployStatus: 'deployed',
      escrowContractAddress: escrowAddress,
      onConflictDoNothing: true, // window defaults (open 2d ago / close 1d ago) keep the window closed
    });
  }

  async function seedBid(chainBidId: number, price: string, count: string, tSec: number, status = 'escrowed'): Promise<void> {
    await q(
      `INSERT INTO "offering_bids" ("offering_id","collector_sub","collector_wallet","price_stroops","count","status","chain_bid_id","escrow_tx_hash","idempotency_hash","created_at")
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6::int, $7, decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'), now() + ($8 || ' seconds')::interval)`,
      [OFFERING_ID, TOKEN_ADDRESS, price, count, status, status === 'escrowed' ? chainBidId : null, status === 'escrowed' ? 'ab'.repeat(32) : null, tSec],
    );
  }

  /** Seed the golden AC book: float 1000; A@150×400, B@120×500, C@100×300, D@80×200. */
  async function seedGoldenBook(): Promise<void> {
    await seedBid(1, '150', '400', 1);
    await seedBid(2, '120', '500', 2);
    await seedBid(3, '100', '300', 3);
    await seedBid(4, '80', '200', 4);
  }

  const login = async (): Promise<string> => {
    const res = await request(server).post('/api/backoffice/v1/auth/login').send({ email, password });
    return (res.body as { accessToken: string }).accessToken;
  };
  const preview = (token: string) =>
    request(server).get(`/api/backoffice/v1/offerings/${OFFERING_ID}/clearing-preview`).set('Authorization', `Bearer ${token}`);
  const settle = (token: string, key: string) =>
    request(server).post(`/api/backoffice/v1/offerings/${OFFERING_ID}/settle`).set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `${runId}-${key}`).send({});
  const getOne = (token: string) =>
    request(server).get(`/api/backoffice/v1/offerings/${OFFERING_ID}`).set('Authorization', `Bearer ${token}`);

  const driveWorker = () => app.get(OfferingSettleProcessor).process({ data: { offeringId: OFFERING_ID } } as never);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(OFFERING_ESCROW_SERVICE)
      .useValue(fakeEscrow)
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
    fakeEscrow.reset();
    await seedAdmin();
  });

  it('E1 (AC-1) golden book: preview shows P=100 + A/B full, C=100, D loses; settle → settled', async () => {
    const escrowAddr = fakeEscrow.addressFor(OFFERING_ID);
    await seedOffering('1000', escrowAddr);
    await seedGoldenBook();
    const token = await login();

    const pv = await preview(token);
    expect(pv.status).toBe(200);
    const p = pv.body as PreviewBody;
    expect(p.fullySubscribed).toBe(true);
    expect(p.clearingPriceStroops).toBe('100');
    expect(p.allocations.map((a) => [a.bidId, a.allocatedCount])).toEqual([
      [1, '400'],
      [2, '500'],
      [3, '100'],
    ]);

    const s = await settle(token, 'k1');
    expect(s.status).toBe(202);
    expect((s.body as { status: string }).status).toBe('subscribed');

    await driveWorker();
    const detail = (await getOne(token)).body as DetailBody;
    expect(detail.status).toBe('settled');
    expect(detail.settlementPhase).toBe('settled'); // TOV-165 FR-05.06 vocabulary

    // The fake recorded the on-chain close_and_settle with P=100 and winners A/B/C.
    expect(fakeEscrow.closeCalls).toContain(OFFERING_ID);
    expect(fakeEscrow.settleCalls).toHaveLength(1);
    expect(fakeEscrow.settleCalls[0].clearingPrice).toBe(100n);
    expect(fakeEscrow.settleCalls[0].allocations).toEqual([
      { bidId: 1, allocated: 400n },
      { bidId: 2, allocated: 500n },
      { bidId: 3, allocated: 100n },
    ]);
  });

  it('E2 (AC-2) audit row: bids_snapshot = sorted walk, clearing_price = P, allocation_map = winners; bids won/lost', async () => {
    const escrowAddr = fakeEscrow.addressFor(OFFERING_ID);
    await seedOffering('1000', escrowAddr);
    await seedGoldenBook();
    const token = await login();
    await settle(token, 'k2');
    await driveWorker();

    const audit = (await q(`SELECT clearing_price_stroops, public_float, total_demand, bids_snapshot, allocation_map, adopted, cleared_allocations_stroops, absorbed_leftover_stroops, total_supply_stroops, artist_retention_stroops, treasury_retention_stroops FROM offering_clearing_audit WHERE offering_id=$1`, [OFFERING_ID])) as Array<{
      clearing_price_stroops: string; public_float: string; total_demand: string; bids_snapshot: unknown[]; allocation_map: unknown[]; adopted: boolean;
      cleared_allocations_stroops: string; absorbed_leftover_stroops: string; total_supply_stroops: string; artist_retention_stroops: string; treasury_retention_stroops: string;
    }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].clearing_price_stroops).toBe('100');
    expect(audit[0].public_float).toBe('1000');
    expect(audit[0].total_demand).toBe('1400');
    expect(audit[0].adopted).toBe(false);
    // TOV-165 mint-conservation snapshot: cleared = Σ winners == public_float; absorbed ≡ 0; supply/retention
    // frozen from the offering snapshot; the mint invariant holds (1000 + 0 + 0 + 0 == 1000).
    expect(audit[0].cleared_allocations_stroops).toBe('1000');
    expect(audit[0].absorbed_leftover_stroops).toBe('0');
    expect(audit[0].total_supply_stroops).toBe('1000');
    expect(audit[0].artist_retention_stroops).toBe('0');
    expect(audit[0].treasury_retention_stroops).toBe('0');
    const mint =
      BigInt(audit[0].cleared_allocations_stroops) +
      BigInt(audit[0].artist_retention_stroops) +
      BigInt(audit[0].treasury_retention_stroops) +
      BigInt(audit[0].absorbed_leftover_stroops);
    expect(mint.toString()).toBe(audit[0].total_supply_stroops);
    // bids_snapshot is the exact sorted-walk input (price DESC): [150,120,100,80].
    expect((audit[0].bids_snapshot as Array<{ priceStroops: string }>).map((b) => b.priceStroops)).toEqual(['150', '120', '100', '80']);
    expect((audit[0].allocation_map as Array<{ chainBidId: number }>).map((a) => a.chainBidId)).toEqual([1, 2, 3]);

    // Bids flipped to terminal won/lost.
    const bids = (await q(`SELECT chain_bid_id, status, allocated_count FROM offering_bids WHERE offering_id=$1 ORDER BY chain_bid_id`, [OFFERING_ID])) as Array<{ chain_bid_id: string; status: string; allocated_count: string }>;
    expect(bids.map((b) => [Number(b.chain_bid_id), b.status])).toEqual([[1, 'won'], [2, 'won'], [3, 'won'], [4, 'lost']]);
    expect(bids[3].allocated_count).toBe('0'); // D lost
  });

  it('E3 undersubscribed → 422 OFFERING_UNDERSUBSCRIBED, no state change', async () => {
    await seedOffering('1000', fakeEscrow.addressFor(OFFERING_ID));
    await seedBid(1, '150', '400', 1); // demand 400 < float 1000
    const token = await login();
    const s = await settle(token, 'k3');
    expect(s.status).toBe(422);
    expect((s.body as { errorCode: string }).errorCode).toBe('OFFERING_UNDERSUBSCRIBED');
    const undersubDetail = (await getOne(token)).body as DetailBody;
    expect(undersubDetail.status).toBe('opened');
    // TOV-165: window is closed (seeded in the past) but the offering never settles → permanent 'closed'.
    expect(undersubDetail.settlementPhase).toBe('closed');
  });

  it('E4 in-flight bid → 409 OFFERING_HAS_INFLIGHT_BIDS', async () => {
    await seedOffering('1000', fakeEscrow.addressFor(OFFERING_ID));
    await seedGoldenBook();
    await seedBid(0, '90', '10', 5, 'submitted'); // in-flight
    const token = await login();
    const s = await settle(token, 'k4');
    expect(s.status).toBe(409);
    expect((s.body as { errorCode: string }).errorCode).toBe('OFFERING_HAS_INFLIGHT_BIDS');
  });

  it('E5 window still open → 409; non-admin → 401', async () => {
    // Re-seed with a FUTURE window close.
    await q(`INSERT INTO "users" ("id","is_active") VALUES ($1,true) ON CONFLICT ("id") DO NOTHING`, [ARTIST_ID]);
    await q(`INSERT INTO "artworks" ("id","status","artist_user_id","title") VALUES ($1,'fractionalized',$2,'M05') ON CONFLICT ("id") DO NOTHING`, [ARTWORK_ID, ARTIST_ID]);
    await q(`INSERT INTO "fraction_contracts" ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol","artist_address","total_supply","artist_retention_pct","treasury_retention_pct","artist_retention_amount","treasury_retention_amount","artist_lockup_days","treasury_lockup_days") VALUES ($1,$2,'deployed',$3,$4,'M05','M5T',$5,'1000000000',10,5,'100000000','50000000',365,730) ON CONFLICT ("id") DO NOTHING`, [FC_ID, ARTWORK_ID, TOKEN_ADDRESS, 'a'.repeat(64), ARTIST_ADDRESS]);
    await insertOffering(q, {
      id: OFFERING_ID,
      artworkId: ARTWORK_ID,
      fractionContractId: FC_ID,
      status: 'opened',
      lowPriceStroops: '1',
      highPriceStroops: '1000000000',
      publicFloat: '1000',
      totalSupplyStroops: '1000',
      windowOpenAt: new Date(Date.now() - 86_400_000),
      windowCloseAt: new Date(Date.now() + 86_400_000), // FUTURE close → window still open (E5)
      createdByAdminSub: SUPERADMIN_ID,
      escrowDeployStatus: 'deployed',
      escrowContractAddress: fakeEscrow.addressFor(OFFERING_ID),
      onConflictDoNothing: true,
    });
    const token = await login();
    const s = await settle(token, 'k5');
    expect(s.status).toBe(409);
    expect((s.body as { errorCode: string }).errorCode).toBe('OFFERING_WINDOW_STILL_OPEN');
    // No auth → 401.
    const anon = await request(server).post(`/api/backoffice/v1/offerings/${OFFERING_ID}/settle`).set('Idempotency-Key', `${runId}-anon`).send({});
    expect(anon.status).toBe(401);
  });

  /**
   * Over-subscription pro-rata book (TOV-162 FR-05.05b): float 1000; A@150×800 fills above P; B/C/D @100 are
   * the `== P` clearing tier `[250,150,100]` (total 500) sharing `remaining_float = 1000−800 = 200` pro-rata →
   * `[100,60,40]`, dust 0; E@90×100 is below P and loses.
   */
  async function seedProRataBook(): Promise<void> {
    await seedBid(1, '150', '800', 1);
    await seedBid(2, '100', '250', 2);
    await seedBid(3, '100', '150', 3);
    await seedBid(4, '100', '100', 4);
    await seedBid(5, '90', '100', 5);
  }

  it('E-PR1 (AC-1): over-subscribed == P tier splits ROUND_DOWN(count×200/500) → [100,60,40]; preview == settle; settles', async () => {
    const escrowAddr = fakeEscrow.addressFor(OFFERING_ID);
    await seedOffering('1000', escrowAddr);
    await seedProRataBook();
    const token = await login();

    const pv = await preview(token);
    expect(pv.status).toBe(200);
    const p = pv.body as PreviewBody;
    expect(p.fullySubscribed).toBe(true);
    expect(p.clearingPriceStroops).toBe('100');
    expect(p.allocations.map((a) => [a.bidId, a.allocatedCount])).toEqual([
      [1, '800'], // > P → full
      [2, '100'], // 250 × 200/500
      [3, '60'], //  150 × 200/500
      [4, '40'], //  100 × 200/500
    ]);
    expect(p.allocations.find((a) => a.bidId === 5)).toBeUndefined(); // below P → not a winner

    const s = await settle(token, 'kpr1');
    expect(s.status).toBe(202);
    await driveWorker();
    expect(((await getOne(token)).body as DetailBody).status).toBe('settled');

    // The settle worker computed the SAME allocation as the preview (parity) and sent it on-chain.
    expect(fakeEscrow.settleCalls[0].clearingPrice).toBe(100n);
    expect(fakeEscrow.settleCalls[0].allocations).toEqual([
      { bidId: 1, allocated: 800n },
      { bidId: 2, allocated: 100n },
      { bidId: 3, allocated: 60n },
      { bidId: 4, allocated: 40n },
    ]);
    // allocation_map = winners; bids 1–4 won, 5 lost.
    const audit = (await q(`SELECT allocation_map FROM offering_clearing_audit WHERE offering_id=$1`, [OFFERING_ID])) as Array<{ allocation_map: Array<{ chainBidId: number }> }>;
    expect(audit[0].allocation_map.map((a) => a.chainBidId)).toEqual([1, 2, 3, 4]);
    const bids = (await q(`SELECT chain_bid_id, status FROM offering_bids WHERE offering_id=$1 ORDER BY chain_bid_id`, [OFFERING_ID])) as Array<{ chain_bid_id: string; status: string }>;
    expect(bids.map((b) => [Number(b.chain_bid_id), b.status])).toEqual([[1, 'won'], [2, 'won'], [3, 'won'], [4, 'won'], [5, 'lost']]);
  });

  it('E-PR2 (AC-2): a > P bidder receives its full count (0 unfilled); a partially-filled == P winner refunds its losing portion', async () => {
    const escrowAddr = fakeEscrow.addressFor(OFFERING_ID);
    await seedOffering('1000', escrowAddr);
    await seedProRataBook();
    const token = await login();
    await settle(token, 'kpr2');
    await driveWorker();

    const bids = (await q(`SELECT chain_bid_id, allocated_count, count, settle_refund_stroops FROM offering_bids WHERE offering_id=$1 ORDER BY chain_bid_id`, [OFFERING_ID])) as Array<{ chain_bid_id: string; allocated_count: string; count: string; settle_refund_stroops: string }>;
    const above = bids.find((b) => Number(b.chain_bid_id) === 1)!;
    expect(above.allocated_count).toBe(above.count); // full count → 0 unfilled ("refund 0" in the FR-05.05b sense)
    expect(above.settle_refund_stroops).toBe('40000'); // uniform-price delta = (150−100)·800
    const tier = bids.find((b) => Number(b.chain_bid_id) === 2)!;
    expect(tier.allocated_count).toBe('100'); // 250 requested, 100 allocated
    expect(tier.settle_refund_stroops).toBe('15000'); // losing-portion refund = (250−100)·100
  });

  it('E7 self-heal: escrow already Settled on-chain → adopt (settled, tx_hash null, no new settle call)', async () => {
    const escrowAddr = fakeEscrow.addressFor(OFFERING_ID);
    await seedOffering('1000', escrowAddr);
    await seedGoldenBook();
    fakeEscrow.setStatus(escrowAddr, 'settled'); // pretend it landed on-chain before the DB latched
    const token = await login();
    await settle(token, 'k7');
    await driveWorker();

    expect(((await getOne(token)).body as DetailBody).status).toBe('settled');
    expect(fakeEscrow.settleCalls).toHaveLength(0); // adopted — no on-chain settle submitted
    const audit = (await q(`SELECT settlement_tx_hash, adopted FROM offering_clearing_audit WHERE offering_id=$1`, [OFFERING_ID])) as Array<{ settlement_tx_hash: string | null; adopted: boolean }>;
    expect(audit[0].adopted).toBe(true);
    expect(audit[0].settlement_tx_hash).toBeNull();
  });
});
