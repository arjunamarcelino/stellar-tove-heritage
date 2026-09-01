import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { RFQ_REPOSITORY, IRfqRepository } from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';

/**
 * DB + repository guard for the TOV-172 (FR-06.01) RFQ ledger. Exercises `RfqRepository` (insert-or-ignore +
 * active-open count) against the pre-migrated `tove_test` DB via the config-free `RfqsModule`, and
 * drift-guards migration 041's CHECK belts, the composite FK, the FULL-unique dedup index, and the
 * immutability guard trigger (`fn_rfqs_guard`) directly at the SQL layer.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

const CONTRACT_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';

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

describe('rfq constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IRfqRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(RfqsModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IRfqRepository>(RFQ_REPOSITORY);
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

  /** Seed a user → artwork → deployed fraction_contract; return the artwork + contract ids. */
  async function seedArtwork(): Promise<{ artworkId: string; contractId: string }> {
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
      [artworks[0].id, CONTRACT_ADDR, WASM, ARTIST_ADDR],
    );
    return { artworkId: artworks[0].id, contractId: contracts[0].id };
  }

  interface RfqOverrides {
    collectorSub?: string;
    artworkId: string;
    fractionContractId: string;
    count?: string;
    price?: string;
    status?: string;
    idempotencyKeyHash?: Buffer;
    expiresAt?: string;
  }

  /** Raw INSERT of an RFQ. Returns the new id. */
  async function insertRfq(o: RfqOverrides): Promise<string> {
    const rows = await q<{ id: string }>(
      `INSERT INTO rfqs (collector_sub, artwork_id, fraction_contract_id, fraction_count,
         max_price_per_fraction_stroops, expires_at, status, idempotency_key_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        o.collectorSub ?? randomUUID(),
        o.artworkId,
        o.fractionContractId,
        o.count ?? '100',
        o.price ?? '150000000',
        o.expiresAt ?? new Date(Date.now() + 48 * 3_600_000).toISOString(),
        o.status ?? 'open',
        o.idempotencyKeyHash ?? idem(1),
      ],
    );
    return rows[0].id;
  }

  // ── repository surface ──────────────────────────────────────────────────
  it('insertOpen returns the row, and null on the idem-hash conflict (ON CONFLICT DO NOTHING)', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const collector = randomUUID();
    const base = {
      collectorSub: collector,
      artworkId,
      fractionContractId: contractId,
      fractionCount: '100',
      maxPricePerFractionStroops: '150000000',
      expiresAt: new Date(Date.now() + 48 * 3_600_000),
      idempotencyKeyHash: idem(10),
    };
    const first = await repo.insertOpen(em(), base);
    expect(first).not.toBeNull();
    expect(first!.status).toBe('open');

    // Same (collector, idem hash) → null (no thrown 23505).
    const dup = await repo.insertOpen(em(), { ...base, fractionCount: '5' });
    expect(dup).toBeNull();
  });

  it('countActiveOpenByCollector counts only that collector\'s open RFQs', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const a = randomUUID();
    const b = randomUUID();
    await insertRfq({ collectorSub: a, artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(20) });
    await insertRfq({ collectorSub: a, artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(21) });
    const other = await insertRfq({ collectorSub: b, artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(22) });
    // Move b's RFQ to a terminal state → excluded from a's (and b's) open count.
    await q(`UPDATE rfqs SET status='canceled' WHERE id=$1`, [other]);

    expect(await repo.countActiveOpenByCollector(a)).toBe(2);
    expect(await repo.countActiveOpenByCollector(b)).toBe(0);
  });

  // ── CHECK belts (23514) ─────────────────────────────────────────────────
  it('rejects zero/negative/oversized price and count, bad idem length, past expiry, bad status', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const F = { artworkId, fractionContractId: contractId };
    await expectPgError(() => insertRfq({ ...F, price: '0', idempotencyKeyHash: idem(30) }), CHECK_VIOLATION, 'CHK_rfqs_price');
    await expectPgError(() => insertRfq({ ...F, count: '0', idempotencyKeyHash: idem(31) }), CHECK_VIOLATION, 'CHK_rfqs_count');
    await expectPgError(
      () => insertRfq({ ...F, price: '79228162514264337593543950336', idempotencyKeyHash: idem(32) }),
      CHECK_VIOLATION,
      'CHK_rfqs_price',
    );
    await expectPgError(
      () => insertRfq({ ...F, idempotencyKeyHash: Buffer.alloc(16, 1) }),
      CHECK_VIOLATION,
      'CHK_rfqs_idem_len',
    );
    await expectPgError(
      () => insertRfq({ ...F, expiresAt: '2000-01-01T00:00:00Z', idempotencyKeyHash: idem(33) }),
      CHECK_VIOLATION,
      'CHK_rfqs_expiry',
    );
    await expectPgError(
      () =>
        q(
          `INSERT INTO rfqs (collector_sub, artwork_id, fraction_contract_id, fraction_count,
             max_price_per_fraction_stroops, expires_at, status, idempotency_key_hash)
           VALUES ($1,$2,$3,'100','150000000',$4,'bogus',$5)`,
          [randomUUID(), artworkId, contractId, new Date(Date.now() + 3_600_000).toISOString(), idem(34)],
        ),
      CHECK_VIOLATION,
      'CHK_rfqs_status',
    );
  });

  // ── composite FK + full-unique dedup index ──────────────────────────────
  it('rejects a fraction_contract_id that does not belong to the artwork (composite FK)', async () => {
    const a = await seedArtwork();
    const b = await seedArtwork(); // a different artwork's contract
    await expectPgError(
      () => insertRfq({ artworkId: a.artworkId, fractionContractId: b.contractId, idempotencyKeyHash: idem(40) }),
      FK_VIOLATION,
      'FK_rfqs_artwork_fc',
    );
  });

  it('UQ_rfqs_idem dedupes on (collector_sub, idempotency_key_hash) and is a FULL (non-partial) index', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const collector = randomUUID();
    await insertRfq({ collectorSub: collector, artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(50) });
    await expectPgError(
      () => insertRfq({ collectorSub: collector, artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(50) }),
      UNIQUE_VIOLATION,
      'UQ_rfqs_idem',
    );

    const idx = await q<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_rfqs_idem'`);
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).not.toMatch(/WHERE/i); // full index — dedup must survive soft-delete
  });

  // ── guard trigger ───────────────────────────────────────────────────────
  it('blocks DELETE, soft-delete, and immutable-column edits; allows a forward status transition', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const id = await insertRfq({ artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(60) });

    await expect(q(`DELETE FROM rfqs WHERE id=$1`, [id])).rejects.toThrow(/cannot be deleted/i);
    await expect(q(`UPDATE rfqs SET deleted_at=now() WHERE id=$1`, [id])).rejects.toThrow(/cannot be soft-deleted/i);
    await expect(
      q(`UPDATE rfqs SET max_price_per_fraction_stroops='1' WHERE id=$1`, [id]),
    ).rejects.toThrow(/immutable columns cannot change/i);
    // A forward status transition (open → canceled) is allowed.
    await q(`UPDATE rfqs SET status='canceled' WHERE id=$1`, [id]);
    const [row] = await q<{ status: string }>(`SELECT status FROM rfqs WHERE id=$1`, [id]);
    expect(row.status).toBe('canceled');
  });

  it('enforces a forward-only status machine (rejects backward / terminal→terminal moves)', async () => {
    const { artworkId, contractId } = await seedArtwork();
    const open = await insertRfq({ artworkId, fractionContractId: contractId, idempotencyKeyHash: idem(70) });
    // backward: open → canceled → open is illegal
    await q(`UPDATE rfqs SET status='canceled' WHERE id=$1`, [open]);
    await expect(q(`UPDATE rfqs SET status='open' WHERE id=$1`, [open])).rejects.toThrow(/illegal status transition/i);
    // terminal → terminal (canceled → filled) is illegal
    await expect(q(`UPDATE rfqs SET status='filled' WHERE id=$1`, [open])).rejects.toThrow(/illegal status transition/i);
  });

  it('IDX_rfqs_active_open serves the per-collector active-open count (partial, open + not-deleted)', async () => {
    const idx = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_rfqs_active_open'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/status.*=.*'open'/i);
    expect(idx[0].indexdef).toMatch(/deleted_at IS NULL/i);
  });

  it('has no single-column FK_rfqs_artwork (composite FK_rfqs_artwork_fc is the only artwork FK)', async () => {
    const fks = await q<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'rfqs'::regclass AND contype = 'f' ORDER BY conname`,
    );
    const names = fks.map((f) => f.conname);
    expect(names).toContain('FK_rfqs_artwork_fc');
    expect(names).not.toContain('FK_rfqs_artwork');
  });
});
