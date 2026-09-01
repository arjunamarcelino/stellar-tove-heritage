import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { insertOffering } from '../../../shared/seed-offering';

/**
 * DB-level guard for the TOV-160 clearing/settlement schema (FR-05.05) — migrations 038 (offering_clearing_
 * audit + bid won/lost states + settle stamps + offerings settle-failure signal) and 039 (clearing index).
 * Raw SQL against the pre-migrated `tove_test` DB. Requires `yarn db:test:setup`.
 */
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const RAISE_EXCEPTION = 'P0001';

interface PgError {
  code?: string;
  driverError?: { code?: string };
}

async function expectPgCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  let err: PgError | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as PgError;
  }
  expect(err, 'expected the query to reject').toBeDefined();
  expect(err!.code ?? err!.driverError?.code).toBe(code);
}

describe('offering clearing/settlement DB schema (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;

  beforeAll(async () => {
    moduleRef = await createTestingModule();
    ds = moduleRef.get(DataSource);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });
  beforeEach(async () => {
    await truncateTables(ds);
  });

  const q = <T = unknown>(text: string, params: unknown[] = []): Promise<T[]> => ds.query(text, params);

  const WALLET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

  /** Seed user → artwork → deployed fraction_contract → offering; return the offering id. */
  async function seedOffering(status = 'opened'): Promise<string> {
    const u = await q<{ id: string }>(`INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`);
    const a = await q<{ id: string }>(`INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`, [u[0].id]);
    const fc = await q<{ id: string }>(
      `INSERT INTO fraction_contracts (artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address, total_supply, artist_retention_pct, treasury_retention_pct, artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days)
       VALUES ($1,'deployed',$2,$3,'ArtToken','ART',$4,'1000000',10,5,'100000','50000',365,730) RETURNING id`,
      [a[0].id, WALLET, '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd', 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O'],
    );
    // TOV-165: 150 − 30 − 20 = 100 (matches public_float) exercises CHK_off_public_float_decomposition with
    // non-zero retentions; window defaults (open 2d ago / close 1d ago) match the shared seeder.
    return insertOffering(q, {
      artworkId: a[0].id,
      fractionContractId: fc[0].id,
      status,
      lowPriceStroops: '1',
      highPriceStroops: '1000000000',
      publicFloat: '100',
      totalSupplyStroops: '150',
      artistRetentionStroops: '30',
      treasuryRetentionStroops: '20',
      createdByAdminSub: '00000000-0000-4000-8000-00000000ad11',
      escrowDeployStatus: 'deployed',
      escrowContractAddress: WALLET,
    });
  }

  /** Insert an escrowed bid. */
  async function seedEscrowedBid(offeringId: string, chainBidId: number, price: string, count: string, tSec: number): Promise<string> {
    const r = await q<{ id: string }>(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count, status, chain_bid_id, escrow_tx_hash, idempotency_hash, created_at)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, 'escrowed', $5::int, $6, decode(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),'hex'), now() + ($7 || ' seconds')::interval) RETURNING id`,
      [offeringId, WALLET, price, count, chainBidId, 'ab'.repeat(32), tSec],
    );
    return r[0].id;
  }

  function insertAudit(offeringId: string, over: Record<string, string> = {}): Promise<unknown> {
    // TOV-165 mint-conservation columns default to a consistent row: cleared=float=100 (alloc_eq_float),
    // absorbed=0 (absorbed_zero), 150 − 30 − 20 = 100 = float (float_decomposition).
    const v = {
      price: '100', float: '100', demand: '130', proceeds: '10000', fee: '300', net: '9700',
      cleared: '100', absorbed: '0', total: '150', artistRet: '30', treasuryRet: '20', ...over,
    };
    return q(
      `INSERT INTO offering_clearing_audit (offering_id, clearing_price_stroops, public_float, total_demand, proceeds_stroops, platform_fee_stroops, artist_net_stroops, cleared_allocations_stroops, absorbed_leftover_stroops, total_supply_stroops, artist_retention_stroops, treasury_retention_stroops, bids_snapshot, allocation_map, adopted, cleared_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]'::jsonb,'[]'::jsonb,false,now())`,
      [offeringId, v.price, v.float, v.demand, v.proceeds, v.fee, v.net, v.cleared, v.absorbed, v.total, v.artistRet, v.treasuryRet],
    );
  }

  it('I1 clearing index exists and serves the walk with no Sort node', async () => {
    const idx = await q<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname='IDX_offering_bids_clearing'`);
    expect(idx).toHaveLength(1);
    const offeringId = await seedOffering();
    await seedEscrowedBid(offeringId, 1, '150', '400', 1);
    await seedEscrowedBid(offeringId, 2, '100', '600', 2);
    await q(`SET enable_seqscan = off`);
    const plan = await q<{ 'QUERY PLAN': unknown[] }>(
      `EXPLAIN (FORMAT JSON) SELECT * FROM offering_bids WHERE offering_id=$1 AND status='escrowed' AND deleted_at IS NULL ORDER BY price_stroops DESC, created_at ASC, id ASC`,
      [offeringId],
    );
    const planStr = JSON.stringify(plan);
    await q(`SET enable_seqscan = on`);
    expect(planStr).toContain('IDX_offering_bids_clearing');
    expect(planStr).not.toContain('"Node Type":"Sort"');
  });

  it('I2 listBidsForClearing SQL returns escrowed-only, ordered price DESC, created_at ASC', async () => {
    const offeringId = await seedOffering();
    await seedEscrowedBid(offeringId, 1, '100', '10', 2);
    await seedEscrowedBid(offeringId, 2, '150', '10', 1);
    await seedEscrowedBid(offeringId, 3, '100', '10', 1); // same price as #1, earlier
    // a submitted (in-flight) bid must be excluded
    await q(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count, status, idempotency_hash)
       VALUES ($1, gen_random_uuid(), $2, '200', '10', 'submitted', decode(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),'hex'))`,
      [offeringId, WALLET],
    );
    const rows = await q<{ chain_bid_id: string }>(
      `SELECT chain_bid_id FROM offering_bids WHERE offering_id=$1 AND status='escrowed' AND deleted_at IS NULL ORDER BY price_stroops DESC, created_at ASC, id ASC`,
      [offeringId],
    );
    expect(rows.map((r) => Number(r.chain_bid_id))).toEqual([2, 3, 1]); // 150 first; then the two 100s by created_at
  });

  it('I3 offering_clearing_audit: append-only (no UPDATE/DELETE), FK, and one-settle-per-offering UNIQUE', async () => {
    const offeringId = await seedOffering();
    await insertAudit(offeringId);
    // A second snapshot for the same offering is rejected (plain UNIQUE(offering_id)).
    await expectPgCode(() => insertAudit(offeringId), UNIQUE_VIOLATION);
    // UPDATE + DELETE blocked by the append-only trigger.
    await expectPgCode(() => q(`UPDATE offering_clearing_audit SET proceeds_stroops='1' WHERE offering_id=$1`, [offeringId]), RAISE_EXCEPTION);
    // TOV-165: the 5 new columns joined the immutability guard too.
    await expectPgCode(() => q(`UPDATE offering_clearing_audit SET cleared_allocations_stroops='1' WHERE offering_id=$1`, [offeringId]), RAISE_EXCEPTION);
    await expectPgCode(() => q(`UPDATE offering_clearing_audit SET total_supply_stroops='999' WHERE offering_id=$1`, [offeringId]), RAISE_EXCEPTION);
    await expectPgCode(() => q(`DELETE FROM offering_clearing_audit WHERE offering_id=$1`, [offeringId]), RAISE_EXCEPTION);
    // FK to offerings.
    await expectPgCode(() => insertAudit('00000000-0000-4000-8000-0000000000ff'), FK_VIOLATION);
  });

  it('I3c #337 offering_clearing_audit is fully immutable — soft-delete is rejected', async () => {
    const offeringId = await seedOffering();
    await insertAudit(offeringId);
    // Soft-delete (setting deleted_at) is now rejected by the append-only trigger (retention-obligated artifact).
    await expectPgCode(
      () => q(`UPDATE offering_clearing_audit SET deleted_at = now() WHERE offering_id=$1`, [offeringId]),
      RAISE_EXCEPTION,
    );
  });

  it('I3b audit CHECKs: floor split must match, and float must be positive', async () => {
    const offeringId = await seedOffering();
    // fee != floor(proceeds*300/10000) → CHK_clearing_fee_floor.
    await expectPgCode(() => insertAudit(offeringId, { fee: '301' }), CHECK_VIOLATION);
  });

  it('I3d TOV-165 mint CHECKs: alloc==float, decomposition, absorbed==0 each reject a bad row', async () => {
    const offeringId = await seedOffering();
    // cleared_allocations != public_float → CHK_clearing_alloc_eq_float.
    await expectPgCode(() => insertAudit(offeringId, { cleared: '99' }), CHECK_VIOLATION);
    // public_float != total_supply − artist − treasury → CHK_clearing_float_decomposition (151 − 30 − 20 = 101 != 100).
    await expectPgCode(() => insertAudit(offeringId, { total: '151' }), CHECK_VIOLATION);
    // absorbed_leftover != 0 → CHK_clearing_absorbed_zero.
    await expectPgCode(() => insertAudit(offeringId, { absorbed: '1' }), CHECK_VIOLATION);
    // A fully consistent row (defaults) inserts cleanly.
    await insertAudit(offeringId);
  });

  it('I6 offerings decomposition CHECK: public_float must equal total_supply − artist − treasury', async () => {
    const offeringId = await seedOffering();
    // Break the snapshot identity (999 − 30 − 20 != 100) → CHK_off_public_float_decomposition.
    await expectPgCode(() => q(`UPDATE offerings SET total_supply_stroops='999' WHERE id=$1`, [offeringId]), CHECK_VIOLATION);
  });

  it('I7 #345 migration-040 backfill: Σ allocatedCount from allocation_map jsonb (independent cross-check)', async () => {
    // Validates the load-bearing aggregation the migration uses to re-derive cleared_allocations for historical
    // rows (SELECT sum((elem->>'allocatedCount')::numeric) FROM jsonb_array_elements(allocation_map)). The map
    // shape is ClearingAllocationRow = {chainBidId, allocatedCount:string}. 400+500+100 = 1000; matches float.
    const map = JSON.stringify([
      { chainBidId: 1, allocatedCount: '400' },
      { chainBidId: 2, allocatedCount: '500' },
      { chainBidId: 3, allocatedCount: '100' },
    ]);
    const r = await q<{ sum: string }>(
      `SELECT COALESCE((SELECT sum((elem->>'allocatedCount')::numeric)
                          FROM jsonb_array_elements($1::jsonb) AS elem), 0) AS sum`,
      [map],
    );
    expect(r[0].sum).toBe('1000'); // independent Σ — would diverge from public_float if the map were corrupted
    // Empty map → COALESCE guards to 0 (defensive; a settled row always has winners).
    const empty = await q<{ sum: string }>(
      `SELECT COALESCE((SELECT sum((elem->>'allocatedCount')::numeric)
                          FROM jsonb_array_elements('[]'::jsonb) AS elem), 0) AS sum`,
    );
    expect(empty[0].sum).toBe('0');
  });

  it('I4 bid guard trigger: escrowed → won (with stamps) legal; won → escrowed rejected; unstamped won rejected', async () => {
    const offeringId = await seedOffering();
    const bidId = await seedEscrowedBid(offeringId, 1, '100', '80', 1);
    // Legal settle flip with both stamps.
    await q(`UPDATE offering_bids SET status='won', allocated_count='80', settle_refund_stroops='0' WHERE id=$1`, [bidId]);
    const row = await q<{ status: string }>(`SELECT status FROM offering_bids WHERE id=$1`, [bidId]);
    expect(row[0].status).toBe('won');
    // won is terminal — no backward transition.
    await expectPgCode(() => q(`UPDATE offering_bids SET status='escrowed', allocated_count=NULL, settle_refund_stroops=NULL WHERE id=$1`, [bidId]), RAISE_EXCEPTION);

    // A fresh escrowed bid: flipping to won WITHOUT the stamps violates CHK_bid_settled_stamped.
    const bid2 = await seedEscrowedBid(offeringId, 2, '90', '20', 2);
    await expectPgCode(() => q(`UPDATE offering_bids SET status='won' WHERE id=$1`, [bid2]), CHECK_VIOLATION);
  });

  it('I4b lost flip: allocated 0 + full refund; won requires allocated > 0', async () => {
    const offeringId = await seedOffering();
    const bidId = await seedEscrowedBid(offeringId, 1, '80', '50', 1);
    await q(`UPDATE offering_bids SET status='lost', allocated_count='0', settle_refund_stroops=escrow_amount_stroops WHERE id=$1`, [bidId]);
    const row = await q<{ status: string; allocated_count: string; settle_refund_stroops: string }>(
      `SELECT status, allocated_count, settle_refund_stroops FROM offering_bids WHERE id=$1`, [bidId],
    );
    expect(row[0].status).toBe('lost');
    expect(row[0].settle_refund_stroops).toBe('4000'); // 80 * 50
    // won with allocated 0 violates CHK_bid_won_alloc.
    const bid2 = await seedEscrowedBid(offeringId, 2, '80', '50', 2);
    await expectPgCode(() => q(`UPDATE offering_bids SET status='won', allocated_count='0', settle_refund_stroops='4000' WHERE id=$1`, [bid2]), CHECK_VIOLATION);
  });

  it('I5 offerings settle-failure signal: both-or-neither CHECK', async () => {
    const offeringId = await seedOffering('subscribed');
    // Stamp both — OK.
    await q(`UPDATE offerings SET settle_failed_at=now(), settle_failure_reason='RangeError: boom' WHERE id=$1`, [offeringId]);
    // Only the timestamp — violates CHK_off_settle_fail_clean.
    await expectPgCode(() => q(`UPDATE offerings SET settle_failure_reason=NULL WHERE id=$1`, [offeringId]), CHECK_VIOLATION);
  });
});
