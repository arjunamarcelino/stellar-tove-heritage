import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { DataSource as DS } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { insertOffering } from '../../../shared/seed-offering';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { RfqNotificationsModule } from '@modules/marketplace/notifications/rfq-notifications.module';
import { RfqFanoutService } from '@modules/marketplace/notifications/fanout/rfq-fanout.service';
import {
  RFQ_REPOSITORY,
  IRfqRepository,
} from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '@modules/offerings/repositories/offering-bid-repository.interface';

/**
 * DB-backed fan-out engine tests (TOV-174). Exercises `RfqFanoutService` against the pre-migrated
 * `tove_test` DB, plus migration 042's guard/latch invariants at the SQL layer.
 * Requires `yarn db:test:setup`.
 */

const CONTRACT_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const WALLET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';

/** Test module: the neutral domains + the fan-out service (no BullMQ — the service is framework-agnostic). */
@Module({
  imports: [RfqNotificationsModule, RfqsModule, OfferingsModule, WalletsAuditModule],
  providers: [RfqFanoutService],
})
class FanoutTestModule {}

describe('rfq notification fan-out (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DS;
  let fanout: RfqFanoutService;
  let rfqRepo: IRfqRepository;
  let bidRepo: IOfferingBidRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(FanoutTestModule);
    ds = moduleRef.get(DS);
    fanout = moduleRef.get(RfqFanoutService);
    rfqRepo = moduleRef.get<IRfqRepository>(RFQ_REPOSITORY);
    bidRepo = moduleRef.get<IOfferingBidRepository>(OFFERING_BID_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateTables(ds);
  });

  const q = <T = unknown>(text: string, params: unknown[] = []): Promise<T[]> => ds.query(text, params);

  async function seedArtwork(): Promise<{ artworkId: string; contractId: string; adminSub: string }> {
    const [{ id: adminSub }] = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'whitelisted') RETURNING id`,
    );
    const [{ id: artworkId }] = await q<{ id: string }>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'Untitled No. 4') RETURNING id`,
      [adminSub],
    );
    const [{ id: contractId }] = await q<{ id: string }>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730) RETURNING id`,
      [artworkId, CONTRACT_ADDR, WASM, ARTIST_ADDR],
    );
    return { artworkId, contractId, adminSub };
  }

  async function insertSettledOffering(artworkId: string, contractId: string, adminSub: string): Promise<string> {
    // A `settled` offering must carry a deployed escrow (CHK_off_approved_has_escrow) — the shared seeder
    // owns that column list.
    return insertOffering((t, p) => ds.query(t, p), {
      artworkId,
      fractionContractId: contractId,
      createdByAdminSub: adminSub,
      status: 'settled',
      escrowDeployStatus: 'deployed',
      escrowContractAddress: CONTRACT_ADDR,
    });
  }

  let idemSeed = 0;
  async function insertWonBid(offeringId: string, collectorSub: string): Promise<void> {
    idemSeed += 1;
    await q(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
         idempotency_hash, status, allocated_count, settle_refund_stroops)
       VALUES ($1,$2,$3,'100000000','10',$4,'won','10','0')`,
      [offeringId, collectorSub, WALLET, Buffer.alloc(32, idemSeed)],
    );
  }

  async function insertNonWinningBid(offeringId: string, collectorSub: string): Promise<void> {
    idemSeed += 1;
    // `submitted` needs no escrow/settle stamps; the finder excludes anything that isn't `won`.
    await q(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
         idempotency_hash, status)
       VALUES ($1,$2,$3,'100000000','10',$4,'submitted')`,
      [offeringId, collectorSub, WALLET, Buffer.alloc(32, idemSeed)],
    );
  }

  async function insertOpenRfq(artworkId: string, contractId: string, collectorSub: string): Promise<string> {
    idemSeed += 1;
    const [{ id }] = await q<{ id: string }>(
      `INSERT INTO rfqs (collector_sub, artwork_id, fraction_contract_id, fraction_count,
         max_price_per_fraction_stroops, expires_at, status, idempotency_key_hash)
       VALUES ($1,$2,$3,'100','150000000',$4,'open',$5) RETURNING id`,
      [collectorSub, artworkId, contractId, new Date(Date.now() + 48 * 3_600_000), Buffer.alloc(32, idemSeed)],
    );
    return id;
  }

  const notifCount = async (rfqId: string): Promise<number> => {
    const [{ n }] = await q<{ n: string }>(`SELECT count(*) n FROM rfq_notifications WHERE rfq_id=$1`, [rfqId]);
    return Number(n);
  };
  const fannedOutAt = async (rfqId: string): Promise<Date | null> => {
    const [{ fanned_out_at }] = await q<{ fanned_out_at: Date | null }>(`SELECT fanned_out_at FROM rfqs WHERE id=$1`, [rfqId]);
    return fanned_out_at;
  };
  const auditCount = async (rfqId: string): Promise<number> => {
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*) n FROM internal_audit_log WHERE kind='rfq.notifications.fanned_out' AND subject_id=$1`,
      [rfqId],
    );
    return Number(n);
  };

  it('creates one row per settled winner, excludes the buyer, latches, writes one audit row', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const w1 = randomUUID();
    const w2 = randomUUID();
    const w3 = randomUUID();
    for (const sub of [buyer, w1, w2, w3]) await insertWonBid(offering, sub); // buyer also won
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);

    await fanout.fanout(rfqId);

    expect(await notifCount(rfqId)).toBe(3); // w1,w2,w3 — NOT the buyer
    const recips = await q<{ recipient_sub: string }>(`SELECT recipient_sub FROM rfq_notifications WHERE rfq_id=$1`, [rfqId]);
    expect(recips.map((r) => r.recipient_sub).sort()).toEqual([w1, w2, w3].sort());
    expect(await fannedOutAt(rfqId)).not.toBeNull();
    expect(await auditCount(rfqId)).toBe(1);
    // recipientCount is the EXACT row count (todo 369), derived inside the winning txn.
    const [{ rc }] = await q<{ rc: string }>(
      `SELECT payload->>'recipientCount' rc FROM internal_audit_log WHERE kind='rfq.notifications.fanned_out' AND subject_id=$1`,
      [rfqId],
    );
    expect(Number(rc)).toBe(3);
  });

  it('0-recipient RFQ (only the buyer won) still latches and is never re-swept', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    await insertWonBid(offering, buyer);
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);

    await fanout.fanout(rfqId);
    expect(await notifCount(rfqId)).toBe(0);
    expect(await fannedOutAt(rfqId)).not.toBeNull();
    // Reconcile finder must NOT return it (latched). graceMs:0 so the just-created RFQ isn't excluded by the
    // recency bound — this asserts the LATCH exclusion specifically.
    const unfanned = await rfqRepo.findUnfannedSince({ windowMs: 86_400_000, graceMs: 0, limit: 100 });
    expect(unfanned).not.toContain(rfqId);
  });

  it('reconcile finder skips a just-created un-latched RFQ until the grace elapses (no redundant re-drive)', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const buyer = randomUUID();
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer); // un-latched, created ~now
    // Large grace → the fresh RFQ is below the grace cutoff → excluded (its primary job may still be running).
    expect(await rfqRepo.findUnfannedSince({ windowMs: 86_400_000, graceMs: 120_000, limit: 100 })).not.toContain(rfqId);
    // graceMs:0 → no recency exclusion → the un-latched RFQ IS returned (it needs a re-drive).
    expect(await rfqRepo.findUnfannedSince({ windowMs: 86_400_000, graceMs: 0, limit: 100 })).toContain(rfqId);
  });

  it('a winner across two settled offerings on one artwork gets exactly one row (DISTINCT + UQ)', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const o1 = await insertSettledOffering(artworkId, contractId, adminSub);
    const o2 = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const w1 = randomUUID();
    await insertWonBid(o1, w1);
    await insertWonBid(o2, w1); // same winner, two offerings
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);

    await fanout.fanout(rfqId);
    expect(await notifCount(rfqId)).toBe(1);
  });

  it('excludes non-won bids (escrowed/lost) from the recipient set', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const winner = randomUUID();
    const nonWinner = randomUUID();
    await insertWonBid(offering, winner);
    await insertNonWinningBid(offering, nonWinner);
    const subs = await bidRepo.findSettledWinnerSubsForArtwork(artworkId, buyer);
    expect(subs).toEqual([winner]);
  });

  it('is idempotent under concurrent + repeated runs: same rows, one audit, one latch', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const w1 = randomUUID();
    const w2 = randomUUID();
    await insertWonBid(offering, w1);
    await insertWonBid(offering, w2);
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);

    // Two concurrent workers race the latch; then a third re-run.
    await Promise.all([fanout.fanout(rfqId), fanout.fanout(rfqId)]);
    await fanout.fanout(rfqId);

    expect(await notifCount(rfqId)).toBe(2); // no duplicates
    expect(await auditCount(rfqId)).toBe(1); // exactly one audit row despite the race
  });

  it('guard: fanned_out_at is write-once and notification rows are immutable', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const w1 = randomUUID();
    await insertWonBid(offering, w1);
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);
    await fanout.fanout(rfqId);

    // A second stamp of fanned_out_at is rejected (write-once).
    await expect(q(`UPDATE rfqs SET fanned_out_at = now() WHERE id=$1`, [rfqId])).rejects.toThrow(/write-once/i);
    // rfqs status transitions still work (guard preserved).
    await q(`UPDATE rfqs SET status='canceled' WHERE id=$1`, [rfqId]);

    const [{ id: notifId }] = await q<{ id: string }>(`SELECT id FROM rfq_notifications WHERE rfq_id=$1 LIMIT 1`, [rfqId]);
    await expect(q(`DELETE FROM rfq_notifications WHERE id=$1`, [notifId])).rejects.toThrow(/cannot be deleted/i);
    await expect(q(`UPDATE rfq_notifications SET deleted_at=now() WHERE id=$1`, [notifId])).rejects.toThrow(/cannot be soft-deleted/i);
    // read_at is NOT frozen (a future mark-unread needs no guard migration).
    await q(`UPDATE rfq_notifications SET read_at=now() WHERE id=$1`, [notifId]);
  });

  it('late fan-out of a canceled RFQ still writes rows + latch (staleness is a read-time concern)', async () => {
    const { artworkId, contractId, adminSub } = await seedArtwork();
    const offering = await insertSettledOffering(artworkId, contractId, adminSub);
    const buyer = randomUUID();
    const w1 = randomUUID();
    await insertWonBid(offering, w1);
    const rfqId = await insertOpenRfq(artworkId, contractId, buyer);
    await q(`UPDATE rfqs SET status='canceled' WHERE id=$1`, [rfqId]);

    await fanout.fanout(rfqId);
    expect(await notifCount(rfqId)).toBe(1);
    expect(await fannedOutAt(rfqId)).not.toBeNull();
  });
});
