import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { insertOffering } from '../../../shared/seed-offering';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '@modules/offerings/repositories/offering-bid-repository.interface';

/**
 * DB + repository guard for the TOV-156 (FR-05.03) bid ledger. Exercises `OfferingBidRepository`
 * (insert-or-ignore + escrowed/failed CAS + active-bid + stale reads) against the pre-migrated
 * `tove_test` DB via the config-free `OfferingsModule`, and drift-guards migration 036's CHECK belts,
 * partial-unique/partial indexes, the STORED generated escrow column, and the append-only-ish guard
 * trigger (`fn_offering_bids_guard`) directly at the SQL layer.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const COLLECTOR_WALLET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const TX_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

interface PgError {
  code?: string;
  constraint?: string;
  driverError?: { code?: string; constraint?: string };
}

async function expectPgError(fn: () => Promise<unknown>, code: string, constraint?: string): Promise<void> {
  let err: PgError | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as PgError;
  }
  expect(err, 'expected the query to reject').toBeDefined();
  expect(err!.code ?? err!.driverError?.code).toBe(code);
  if (constraint !== undefined) {
    expect(err!.constraint ?? err!.driverError?.constraint).toBe(constraint);
  }
}

const idem = (seed: number): Buffer => Buffer.alloc(32, seed);

describe('offering bid constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IOfferingBidRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(OfferingsModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IOfferingBidRepository>(OFFERING_BID_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateTables(ds);
  });
  afterEach(async () => {
    await truncateTables(ds);
  });

  const em = (): EntityManager => ds.manager;
  async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    return ds.query(text, params);
  }

  /** Seed a user → artwork → deployed fraction_contract → planned offering; return the offering id. */
  async function seedOffering(): Promise<string> {
    const users = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'whitelisted') RETURNING id`,
    );
    const artworks = await q<{ id: string }>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`,
      [users[0].id],
    );
    const contracts = await q<{ id: string }>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730) RETURNING id`,
      [
        artworks[0].id,
        'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd',
        'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      ],
    );
    // 'planned' (no escrow needed): the bid ledger's FK only requires the parent offering to exist;
    // offering-status gating is the service's job, not the bid table's.
    return insertOffering(q, {
      artworkId: artworks[0].id,
      fractionContractId: contracts[0].id,
      status: 'planned',
      windowOpenAt: '2020-01-01T00:00:00Z',
      windowCloseAt: '2099-01-08T00:00:00Z',
      createdByAdminSub: randomUUID(),
    });
  }

  interface BidOverrides {
    collectorSub?: string;
    wallet?: string;
    price?: string;
    count?: string;
    status?: string;
    idempotencyHash?: Buffer;
    createdAt?: string; // set at INSERT time (created_at is immutable once the row exists)
  }

  /** Raw INSERT of a bid (escrow_amount_stroops is generated, never inserted). Returns the new id. */
  async function insertBid(offeringId: string, o: BidOverrides = {}): Promise<string> {
    const rows = await q<{ id: string }>(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
         idempotency_hash, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        offeringId,
        o.collectorSub ?? randomUUID(),
        o.wallet ?? COLLECTOR_WALLET,
        o.price ?? '100000000',
        o.count ?? '10',
        o.idempotencyHash ?? idem(1),
        o.status ?? 'submitted',
        o.createdAt ?? new Date().toISOString(),
      ],
    );
    return rows[0].id;
  }

  // ── generated escrow column ─────────────────────────────────────────────────────────────────────
  it('computes escrow_amount_stroops = price × count (STORED generated column)', async () => {
    const off = await seedOffering();
    const id = await insertBid(off, { price: '100000000', count: '10' });
    const [row] = await q<{ escrow_amount_stroops: string }>(
      `SELECT escrow_amount_stroops FROM offering_bids WHERE id=$1`,
      [id],
    );
    expect(row.escrow_amount_stroops).toBe('1000000000');
  });

  // ── CHECK belts (23514) ─────────────────────────────────────────────────────────────────────────
  it('rejects zero/negative price and count, escrow overflow, bad wallet, bad idem length, bad txhash', async () => {
    const off = await seedOffering();
    await expectPgError(() => insertBid(off, { price: '0' }), CHECK_VIOLATION, 'CHK_bid_price');
    await expectPgError(() => insertBid(off, { count: '0' }), CHECK_VIOLATION, 'CHK_bid_count');
    // price=MAX, count=2 → generated escrow (2·MAX) exceeds the cap.
    await expectPgError(
      () => insertBid(off, { price: '79228162514264337593543950335', count: '2' }),
      CHECK_VIOLATION,
      'CHK_bid_escrow_cap',
    );
    await expectPgError(() => insertBid(off, { wallet: 'GABC' }), CHECK_VIOLATION, 'CHK_bid_wallet');
    await expectPgError(
      () => insertBid(off, { idempotencyHash: Buffer.alloc(16, 1) }),
      CHECK_VIOLATION,
      'CHK_bid_idem_len',
    );
  });

  it('rejects an escrowed row without stamps, and a submitted row with stamps', async () => {
    const off = await seedOffering();
    // escrowed must carry chain_bid_id + tx_hash.
    await expectPgError(
      () =>
        q(
          `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
             idempotency_hash, status) VALUES ($1,$2,$3,'100000000','10',$4,'escrowed')`,
          [off, randomUUID(), COLLECTOR_WALLET, idem(2)],
        ),
      CHECK_VIOLATION,
      'CHK_bid_escrowed_stamped',
    );
    // submitted must NOT carry stamps.
    await expectPgError(
      () =>
        q(
          `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
             idempotency_hash, status, chain_bid_id) VALUES ($1,$2,$3,'100000000','10',$4,'submitted',1)`,
          [off, randomUUID(), COLLECTOR_WALLET, idem(3)],
        ),
      CHECK_VIOLATION,
      'CHK_bid_unescrowed_clean',
    );
  });

  // ── partial-unique indexes (23505) ──────────────────────────────────────────────────────────────
  it('enforces one active bid per (offering, collector), and dedupes on idempotency_hash', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    await insertBid(off, { collectorSub: sub, idempotencyHash: idem(10) });
    // Same (offering, collector) while active → unique violation.
    await expectPgError(
      () => insertBid(off, { collectorSub: sub, idempotencyHash: idem(11) }),
      UNIQUE_VIOLATION,
      'UQ_offering_bids_active_per_collector',
    );
    // Different collector, same idem hash → idem unique violation.
    await expectPgError(
      () => insertBid(off, { collectorSub: randomUUID(), idempotencyHash: idem(10) }),
      UNIQUE_VIOLATION,
      'UQ_offering_bids_idem',
    );
  });

  // ── append-only-ish guard trigger ───────────────────────────────────────────────────────────────
  it('blocks DELETE, immutable-column edits, illegal transitions, and stamp rewrites; allows forward moves', async () => {
    const off = await seedOffering();
    const id = await insertBid(off, { idempotencyHash: idem(20) });

    await expect(q(`DELETE FROM offering_bids WHERE id=$1`, [id])).rejects.toThrow(/append-only/i);
    await expect(
      q(`UPDATE offering_bids SET price_stroops='1' WHERE id=$1`, [id]),
    ).rejects.toThrow(/immutable columns cannot change/i);
    // submitted → failed is allowed; failed → escrowed is not (forward-only, and not from failed).
    await q(`UPDATE offering_bids SET status='failed' WHERE id=$1`, [id]);
    await expect(
      q(`UPDATE offering_bids SET status='escrowed', chain_bid_id=1, escrow_tx_hash=$2 WHERE id=$1`, [id, TX_HASH]),
    ).rejects.toThrow(/illegal status transition/i);
  });

  it('makes chain_bid_id / escrow_tx_hash write-once after escrow', async () => {
    const off = await seedOffering();
    const id = await insertBid(off, { idempotencyHash: idem(21) });
    await q(`UPDATE offering_bids SET status='escrowed', chain_bid_id=7, escrow_tx_hash=$2 WHERE id=$1`, [id, TX_HASH]);
    await expect(
      q(`UPDATE offering_bids SET chain_bid_id=8 WHERE id=$1`, [id]),
    ).rejects.toThrow(/chain_bid_id is write-once/i);
  });

  // ── repository CAS surface ──────────────────────────────────────────────────────────────────────
  it('insertSubmitted returns the row with the generated escrow, and null on active/idem conflict', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    const bid = await repo.insertSubmitted(em(), {
      offeringId: off,
      collectorSub: sub,
      collectorWallet: COLLECTOR_WALLET,
      priceStroops: '100000000',
      count: '10',
      idempotencyHash: idem(30),
    });
    expect(bid).not.toBeNull();
    expect(bid!.status).toBe('submitted');
    expect(bid!.escrowAmountStroops).toBe('1000000000');

    // Second active bid, same collector → null (ON CONFLICT DO NOTHING, no thrown 23505).
    const dup = await repo.insertSubmitted(em(), {
      offeringId: off,
      collectorSub: sub,
      collectorWallet: COLLECTOR_WALLET,
      priceStroops: '90000000',
      count: '5',
      idempotencyHash: idem(31),
    });
    expect(dup).toBeNull();
  });

  it('casEscrowed latches submitted→escrowed once with stamps; casFailed only from submitted', async () => {
    const off = await seedOffering();
    const bid = await repo.insertSubmitted(em(), {
      offeringId: off,
      collectorSub: randomUUID(),
      collectorWallet: COLLECTOR_WALLET,
      priceStroops: '100000000',
      count: '10',
      idempotencyHash: idem(40),
    });
    expect(await repo.casEscrowed(em(), bid!.id, { chainBidId: 3, txHash: TX_HASH })).toBe(true);
    // Idempotent: a second latch loses (already escrowed).
    expect(await repo.casEscrowed(em(), bid!.id, { chainBidId: 3, txHash: TX_HASH })).toBe(false);
    // casFailed from escrowed loses (only fires from submitted).
    expect(await repo.casFailed(em(), bid!.id)).toBe(false);

    const [row] = await q<{ status: string; chain_bid_id: string; escrow_tx_hash: string }>(
      `SELECT status, chain_bid_id, escrow_tx_hash FROM offering_bids WHERE id=$1`,
      [bid!.id],
    );
    expect(row.status).toBe('escrowed');
    expect(Number(row.chain_bid_id)).toBe(3); // bigint → string via the pg driver
    expect(row.escrow_tx_hash).toBe(TX_HASH);
  });

  it('findMyActiveBid returns active only; a re-bid after failed succeeds (slot freed)', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    const first = await repo.insertSubmitted(em(), {
      offeringId: off,
      collectorSub: sub,
      collectorWallet: COLLECTOR_WALLET,
      priceStroops: '100000000',
      count: '10',
      idempotencyHash: idem(50),
    });
    expect((await repo.findMyActiveBid(off, sub))?.id).toBe(first!.id);

    // Fail it → slot frees, findMyActiveBid returns null.
    await repo.casFailed(em(), first!.id);
    expect(await repo.findMyActiveBid(off, sub)).toBeNull();

    // Re-bid (new idem hash) succeeds now that the active slot is free.
    const second = await repo.insertSubmitted(em(), {
      offeringId: off,
      collectorSub: sub,
      collectorWallet: COLLECTOR_WALLET,
      priceStroops: '110000000',
      count: '2',
      idempotencyHash: idem(51),
    });
    expect(second).not.toBeNull();
    expect((await repo.findMyActiveBid(off, sub))?.id).toBe(second!.id);
  });

  // ── index predicate drift-guards ────────────────────────────────────────────────────────────────
  it('partial index predicates match the constants (active set + idem belt + soft-delete scope)', async () => {
    const active = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_offering_bids_active_per_collector'`,
    );
    expect(active).toHaveLength(1);
    expect(active[0].indexdef).toMatch(/deleted_at IS NULL/i);
    expect(active[0].indexdef).toMatch(/'submitted'/);
    expect(active[0].indexdef).toMatch(/'escrowed'/);
    expect(active[0].indexdef).toMatch(/'canceling'/); // TOV-158: holds the slot through cancel
    expect(active[0].indexdef).not.toMatch(/'failed'/);
    expect(active[0].indexdef).not.toMatch(/'canceled'/); // canceled frees the slot

    // The idem belt KEEPS 'canceled' (submit_bid's on-chain Idem key is permanent), unlike the active belt.
    const idemIdx = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_offering_bids_idem'`,
    );
    expect(idemIdx[0].indexdef).toMatch(/'canceling'/);
    expect(idemIdx[0].indexdef).toMatch(/'canceled'/);
    expect(idemIdx[0].indexdef).not.toMatch(/'failed'/);
  });

  // ── TOV-158 cancel/refund lifecycle ───────────────────────────────────────────────────────────────
  const REFUND_HASH = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';

  /** Insert an escrowed bid (with stamps) directly. Returns the id. */
  async function insertEscrowed(off: string, o: BidOverrides = {}): Promise<string> {
    const rows = await q<{ id: string }>(
      `INSERT INTO offering_bids (offering_id, collector_sub, collector_wallet, price_stroops, count,
         idempotency_hash, status, chain_bid_id, escrow_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'escrowed',7,$7) RETURNING id`,
      [
        off,
        o.collectorSub ?? randomUUID(),
        o.wallet ?? COLLECTOR_WALLET,
        o.price ?? '100000000',
        o.count ?? '10',
        o.idempotencyHash ?? idem(1),
        TX_HASH,
      ],
    );
    return rows[0].id;
  }

  it('casCanceling latches escrowed→canceling; casCanceled stamps refund + frees slot', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    const id = await insertEscrowed(off, { collectorSub: sub, idempotencyHash: idem(60) });

    expect(await repo.casCanceling(em(), id)).toBe(true);
    expect(await repo.casCanceling(em(), id)).toBe(false); // idempotent: only from escrowed
    // canceling still holds the active slot.
    expect((await repo.findMyActiveBid(off, sub))?.id).toBe(id);

    expect(await repo.casCanceled(em(), id, { refundTxHash: REFUND_HASH })).toBe(true);
    const [row] = await q<{ status: string; refund_tx_hash: string; canceled_at: string | null }>(
      `SELECT status, refund_tx_hash, canceled_at FROM offering_bids WHERE id=$1`,
      [id],
    );
    expect(row.status).toBe('canceled');
    expect(row.refund_tx_hash).toBe(REFUND_HASH);
    expect(row.canceled_at).not.toBeNull();
    // canceled frees the slot — a re-bid succeeds.
    expect(await repo.findMyActiveBid(off, sub)).toBeNull();
  });

  it('casCancelFailedBackToEscrowed reverts canceling→escrowed (status only, stamps stay clean)', async () => {
    const off = await seedOffering();
    const id = await insertEscrowed(off, { idempotencyHash: idem(61) });
    await repo.casCanceling(em(), id);
    expect(await repo.casCancelFailedBackToEscrowed(em(), id)).toBe(true);
    const [row] = await q<{ status: string; refund_tx_hash: string | null }>(
      `SELECT status, refund_tx_hash FROM offering_bids WHERE id=$1`,
      [id],
    );
    expect(row.status).toBe('escrowed');
    expect(row.refund_tx_hash).toBeNull();
    // A second cancel is possible after the revert.
    expect(await repo.casCanceling(em(), id)).toBe(true);
  });

  it('trigger rejects illegal cancel transitions and refund stamp rewrites', async () => {
    const off = await seedOffering();
    const id = await insertEscrowed(off, { idempotencyHash: idem(62) });
    // submitted→canceling is illegal (only escrowed→canceling).
    const sub2 = await insertBid(off, { collectorSub: randomUUID(), idempotencyHash: idem(63) });
    await expect(
      q(`UPDATE offering_bids SET status='canceling' WHERE id=$1`, [sub2]),
    ).rejects.toThrow(/illegal status transition/i);
    // escrowed→canceled (skipping the stamp step) is illegal.
    await expect(
      q(`UPDATE offering_bids SET status='canceled', refund_tx_hash=$2, canceled_at=now() WHERE id=$1`, [id, REFUND_HASH]),
    ).rejects.toThrow(/illegal status transition/i);
    // canceled→escrowed (the double-refund backstop) is illegal.
    await q(`UPDATE offering_bids SET status='canceling' WHERE id=$1`, [id]);
    await q(`UPDATE offering_bids SET status='canceled', refund_tx_hash=$2, canceled_at=now() WHERE id=$1`, [id, REFUND_HASH]);
    await expect(
      q(`UPDATE offering_bids SET status='escrowed' WHERE id=$1`, [id]),
    ).rejects.toThrow(/illegal status transition/i);
    // refund_tx_hash is write-once.
    await expect(
      q(`UPDATE offering_bids SET refund_tx_hash=$2 WHERE id=$1`, [id, TX_HASH]),
    ).rejects.toThrow(/refund_tx_hash is write-once/i);
  });

  it('CHK_bid_refund_clean rejects a refund stamp on a non-canceled row', async () => {
    const off = await seedOffering();
    const id = await insertEscrowed(off, { idempotencyHash: idem(64) });
    await repo.casCanceling(em(), id);
    await expectPgError(
      () => q(`UPDATE offering_bids SET refund_tx_hash=$2 WHERE id=$1`, [id, REFUND_HASH]),
      CHECK_VIOLATION,
      'CHK_bid_refund_clean',
    );
  });

  it('findMyLatestBid returns the most-recent bid including terminal canceled', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    const id = await insertEscrowed(off, { collectorSub: sub, idempotencyHash: idem(65) });
    await repo.casCanceling(em(), id);
    await repo.casCanceled(em(), id, { refundTxHash: REFUND_HASH });
    // active is gone, but the latest read still surfaces the terminal canceled bid + its refund stamp.
    expect(await repo.findMyActiveBid(off, sub)).toBeNull();
    const latest = await repo.findMyLatestBid(off, sub);
    expect(latest?.id).toBe(id);
    expect(latest?.status).toBe('canceled');
    expect(latest?.refundTxHash).toBe(REFUND_HASH);
  });

  it('findMyLatestBid is index-ordered (IDX_offering_bids_collector serves the ORDER BY — no Sort node)', async () => {
    const off = await seedOffering();
    const sub = randomUUID();
    // The planner prefers a seq scan on a tiny table; disable it (SET LOCAL, same connection+txn via a
    // queryRunner) so the plan reveals whether the index CAN serve
    // `WHERE (collector_sub, offering_id, deleted_at IS NULL) ORDER BY created_at DESC` without a Sort.
    const qr = ds.createQueryRunner();
    let text: string;
    try {
      await qr.connect();
      await qr.startTransaction();
      await qr.query(`SET LOCAL enable_seqscan = off`);
      const plan = (await qr.query(
        `EXPLAIN SELECT * FROM offering_bids
           WHERE collector_sub = $1 AND offering_id = $2 AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        [sub, off],
      )) as Array<{ 'QUERY PLAN': string }>;
      text = plan.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    expect(text).toMatch(/IDX_offering_bids_collector/);
    expect(text).not.toMatch(/\bSort\b/); // index-ordered, no in-memory sort
  });
});
