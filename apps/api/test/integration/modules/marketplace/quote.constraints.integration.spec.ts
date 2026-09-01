import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { QuotesModule } from '@modules/marketplace/quotes/quotes.module';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import { seedArtworkWithContract, seedOpenRfq } from '../../../shared/seed-marketplace';

/**
 * DB + repository guard for the TOV-175 (FR-06.03) quote ledger. Exercises `QuoteRepository` against the
 * pre-migrated `tove_test` DB via the config-free `QuotesModule`, and drift-guards migration 044's CHECK
 * belts, the composite anti-drift FK, the FULL-unique dedup + partial active-per-RFQ indexes, and the
 * immutability/forward-only guard trigger (`fn_quotes_guard`) directly at the SQL layer.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';


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
const future = (): string => new Date(Date.now() + 48 * 3_600_000).toISOString();

describe('quote constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IQuoteRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(QuotesModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IQuoteRepository>(QUOTE_REPOSITORY);
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

  interface QuoteOverrides {
    rfqId: string;
    holderSub?: string;
    fractionContractId: string;
    count?: string;
    price?: string;
    validUntil?: string;
    status?: string;
    idempotencyKeyHash?: Buffer;
    createdAt?: string;
  }

  /** Raw INSERT of a quote (created_at settable to forge a lapsed-but-valid-at-creation row). Returns the id. */
  async function insertQuote(o: QuoteOverrides): Promise<string> {
    const cols = ['rfq_id', 'holder_sub', 'fraction_contract_id', 'fraction_count',
      'price_per_fraction_stroops', 'valid_until', 'status', 'idempotency_key_hash'];
    const vals: unknown[] = [
      o.rfqId,
      o.holderSub ?? randomUUID(),
      o.fractionContractId,
      o.count ?? '10',
      o.price ?? '150000000',
      o.validUntil ?? future(),
      o.status ?? 'open',
      o.idempotencyKeyHash ?? idem(1),
    ];
    if (o.createdAt) {
      cols.push('created_at');
      vals.push(o.createdAt);
    }
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    const rows = await q<{ id: string }>(
      `INSERT INTO rfq_quotes (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${ph}) RETURNING id`,
      vals,
    );
    return rows[0].id;
  }

  // ── repository surface ──────────────────────────────────────────────────
  it('insertOpen returns the row, and null on the idem conflict (ON CONFLICT DO NOTHING)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    const base = {
      rfqId,
      holderSub: holder,
      fractionContractId: contractId,
      fractionCount: '25',
      pricePerFractionStroops: '150000000',
      validUntil: new Date(Date.now() + 24 * 3_600_000),
      idempotencyKeyHash: idem(10),
    };
    const first = await repo.insertOpen(em(), base);
    expect(first).not.toBeNull();
    expect(first!.status).toBe('open');

    const dup = await repo.insertOpen(em(), { ...base, fractionCount: '5' });
    expect(dup).toBeNull();
  });

  it('hasOpenQuoteForRfq reflects only open, non-soft-deleted quotes for that (rfq, holder)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    expect(await repo.hasOpenQuoteForRfq(rfqId, holder)).toBe(false);
    const id = await insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(11) });
    expect(await repo.hasOpenQuoteForRfq(rfqId, holder)).toBe(true);
    // A terminal status frees the slot.
    await q(`UPDATE rfq_quotes SET status='canceled' WHERE id=$1`, [id]);
    expect(await repo.hasOpenQuoteForRfq(rfqId, holder)).toBe(false);
  });

  it('hasOpenQuoteForRfq({excludeLapsed}) ignores a lapsed-but-open quote (TOV-175 #370 pre-check)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    // A lapsed (valid_until in the past) but still-open quote.
    await insertQuote({
      rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(17),
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      validUntil: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    // Default (authoritative under-lock) still sees it as an open slot...
    expect(await repo.hasOpenQuoteForRfq(rfqId, holder)).toBe(true);
    // ...but the pre-check excludes it, so the holder is not falsely blocked from re-quoting.
    expect(await repo.hasOpenQuoteForRfq(rfqId, holder, { excludeLapsed: true })).toBe(false);
  });

  it('sumOpenLockedCount sums only open + not-yet-expired quotes for that (holder, token)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    // The locked-sum spans the holder's open quotes across DIFFERENT RFQs on the same token
    // (one open quote per RFQ is enforced by UQ_quotes_active_per_rfq).
    const rfq1 = await seedOpenRfq(q, artworkId, contractId);
    const rfq2 = await seedOpenRfq(q, artworkId, contractId);
    const rfq3 = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    await insertQuote({ rfqId: rfq1, holderSub: holder, fractionContractId: contractId, count: '6', idempotencyKeyHash: idem(12) });
    // A lapsed (valid_until in the past) open quote is EXCLUDED from the locked-sum.
    await insertQuote({
      rfqId: rfq2, holderSub: holder, fractionContractId: contractId, count: '100', idempotencyKeyHash: idem(13),
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      validUntil: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    // A different holder's quote is excluded.
    await insertQuote({ rfqId: rfq3, fractionContractId: contractId, count: '50', idempotencyKeyHash: idem(14) });
    expect(await repo.sumOpenLockedCount(em(), holder, contractId)).toBe(6n);
    // Empty set → 0n (no BigInt(null) throw).
    expect(await repo.sumOpenLockedCount(em(), randomUUID(), contractId)).toBe(0n);
  });

  it('reapLapsed flips the holder own lapsed open quotes to expired and returns the count', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfq1 = await seedOpenRfq(q, artworkId, contractId);
    const rfq2 = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    const lapsed = await insertQuote({
      rfqId: rfq1, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(15),
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      validUntil: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    });
    const live = await insertQuote({ rfqId: rfq2, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(16) });
    const reaped = await repo.reapLapsed(em(), holder, contractId);
    expect(reaped).toBe(1);
    const [a] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [lapsed]);
    const [b] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [live]);
    expect(a.status).toBe('expired');
    expect(b.status).toBe('open');
  });

  // ── CHECK belts (23514) ─────────────────────────────────────────────────
  it('rejects zero/oversized price and count, bad idem length, past validity, bad status', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const F = { rfqId, fractionContractId: contractId };
    await expectPgError(() => insertQuote({ ...F, price: '0', idempotencyKeyHash: idem(30) }), CHECK_VIOLATION, 'CHK_quotes_price');
    await expectPgError(() => insertQuote({ ...F, count: '0', idempotencyKeyHash: idem(31) }), CHECK_VIOLATION, 'CHK_quotes_count');
    await expectPgError(
      () => insertQuote({ ...F, price: '79228162514264337593543950336', idempotencyKeyHash: idem(32) }),
      CHECK_VIOLATION, 'CHK_quotes_price',
    );
    await expectPgError(
      () => insertQuote({ ...F, idempotencyKeyHash: Buffer.alloc(16, 1) }),
      CHECK_VIOLATION, 'CHK_quotes_idem_len',
    );
    // valid_until <= created_at (both explicit).
    await expectPgError(
      () => insertQuote({ ...F, idempotencyKeyHash: idem(33), createdAt: new Date().toISOString(), validUntil: '2000-01-01T00:00:00Z' }),
      CHECK_VIOLATION, 'CHK_quotes_validity',
    );
    await expectPgError(
      () => q(
        `INSERT INTO rfq_quotes (rfq_id, holder_sub, fraction_contract_id, fraction_count,
           price_per_fraction_stroops, valid_until, status, idempotency_key_hash)
         VALUES ($1,$2,$3,'10','150000000',$4,'bogus',$5)`,
        [rfqId, randomUUID(), contractId, future(), idem(34)],
      ),
      CHECK_VIOLATION, 'CHK_quotes_status',
    );
  });

  // ── composite anti-drift FK + unique indexes ────────────────────────────
  it('rejects a fraction_contract_id that does not match the parent RFQ (composite FK)', async () => {
    const a = await seedArtworkWithContract(q);
    const b = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, a.artworkId, a.contractId);
    await expectPgError(
      () => insertQuote({ rfqId, fractionContractId: b.contractId, idempotencyKeyHash: idem(40) }),
      FK_VIOLATION, 'FK_quotes_rfq_fc',
    );
  });

  it('UQ_quotes_idem dedupes on (holder_sub, rfq_id, idempotency_key_hash) and is FULL (non-partial)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    await insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(50) });
    await expectPgError(
      () => insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, count: '99', idempotencyKeyHash: idem(50) }),
      UNIQUE_VIOLATION, 'UQ_quotes_idem',
    );
    const idx = await q<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_quotes_idem'`);
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).not.toMatch(/WHERE/i);
  });

  it('UQ_quotes_active_per_rfq blocks a 2nd open quote per (rfq, holder); a terminal status frees the slot', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const holder = randomUUID();
    const first = await insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(60) });
    await expectPgError(
      () => insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(61) }),
      UNIQUE_VIOLATION, 'UQ_quotes_active_per_rfq',
    );
    // Expire the first → the slot frees, a new open quote is allowed.
    await q(`UPDATE rfq_quotes SET status='expired' WHERE id=$1`, [first]);
    const second = await insertQuote({ rfqId, holderSub: holder, fractionContractId: contractId, idempotencyKeyHash: idem(62) });
    expect(second).toBeTruthy();
  });

  it('repo.softRemove is banned (rfq_quotes rows are immutable) — clear error, not a raw DB 500 (#378)', async () => {
    await expect(repo.softRemove({ id: randomUUID() } as never)).rejects.toThrow(/immutable|not supported/i);
  });

  it('IDX_quotes_locked is partial on (open, not-deleted)', async () => {
    const idx = await q<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_quotes_locked'`);
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/status.*=.*'open'/i);
    expect(idx[0].indexdef).toMatch(/deleted_at IS NULL/i);
  });

  it('the parent rfqs table carries the composite-FK target UQ_rfqs_id_fc', async () => {
    const cons = await q<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'rfqs'::regclass AND conname = 'UQ_rfqs_id_fc'`,
    );
    expect(cons).toHaveLength(1);
  });

  // ── guard trigger ───────────────────────────────────────────────────────
  it('blocks DELETE, soft-delete, and immutable-column edits; allows a forward status transition', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const id = await insertQuote({ rfqId, fractionContractId: contractId, idempotencyKeyHash: idem(70) });

    await expect(q(`DELETE FROM rfq_quotes WHERE id=$1`, [id])).rejects.toThrow(/cannot be deleted/i);
    await expect(q(`UPDATE rfq_quotes SET deleted_at=now() WHERE id=$1`, [id])).rejects.toThrow(/cannot be soft-deleted/i);
    await expect(
      q(`UPDATE rfq_quotes SET price_per_fraction_stroops='1' WHERE id=$1`, [id]),
    ).rejects.toThrow(/immutable columns cannot change/i);
    await q(`UPDATE rfq_quotes SET status='accepted' WHERE id=$1`, [id]);
    const [row] = await q<{ status: string }>(`SELECT status FROM rfq_quotes WHERE id=$1`, [id]);
    expect(row.status).toBe('accepted');
  });

  it('enforces a forward-only status machine (rejects backward / terminal→terminal moves)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const id = await insertQuote({ rfqId, fractionContractId: contractId, idempotencyKeyHash: idem(80) });
    await q(`UPDATE rfq_quotes SET status='expired' WHERE id=$1`, [id]);
    await expect(q(`UPDATE rfq_quotes SET status='open' WHERE id=$1`, [id])).rejects.toThrow(/illegal status transition/i);
    await expect(q(`UPDATE rfq_quotes SET status='accepted' WHERE id=$1`, [id])).rejects.toThrow(/illegal status transition/i);
  });
});
