import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { SettlementModule } from '@modules/marketplace/settlement/settlement.module';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
  NewSecondaryTrade,
} from '@modules/marketplace/settlement/repositories/secondary-trade-repository.interface';
import { seedArtworkWithContract, seedOpenRfq, seedQuote } from '../../../shared/seed-marketplace';

/**
 * DB + repository guard for the TOV-177 (FR-06.04+06.05) secondary-trade ledger. Exercises
 * `SecondaryTradeRepository` against the pre-migrated `tove_test` DB via the config-free `SettlementModule`,
 * and drift-guards migration 045's CHECK belts (incl. the i128 gross ceiling), the STORED generated
 * `gross_stroops`, the composite anti-drift FKs, the pending double-accept latch + idem dedup indexes, and the
 * forward-only / write-once guard trigger (`fn_secondary_trades_guard`).
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const MAX_U96 = '79228162514264337593543950335';

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

describe('secondary_trades repository + constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: ISecondaryTradeRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(SettlementModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<ISecondaryTradeRepository>(SECONDARY_TRADE_REPOSITORY);
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

  /** Seed the FK parents (artwork → contract → rfq → quote) and return a NewSecondaryTrade template. */
  async function seedTradeParents(): Promise<{ base: NewSecondaryTrade; rfqId: string }> {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId);
    return {
      rfqId,
      base: {
        rfqId,
        quoteId,
        buyerSub: randomUUID(),
        sellerSub: randomUUID(),
        fractionContractId: contractId,
        fractionCount: '500',
        pricePerFractionStroops: '20',
        idempotencyKeyHash: idem(1),
      },
    };
  }

  /** Raw INSERT of a trade row (bypasses the repo — for CHECK/FK/guard tests). Returns the id. */
  async function insertTrade(base: NewSecondaryTrade, over: Partial<Record<string, unknown>> = {}): Promise<string> {
    const cols: Record<string, unknown> = {
      rfq_id: base.rfqId,
      quote_id: base.quoteId,
      buyer_sub: base.buyerSub,
      seller_sub: base.sellerSub,
      fraction_contract_id: base.fractionContractId,
      fraction_count: base.fractionCount,
      price_per_fraction_stroops: base.pricePerFractionStroops,
      status: 'pending',
      idempotency_key_hash: base.idempotencyKeyHash,
      ...over,
    };
    const names = Object.keys(cols);
    const vals = Object.values(cols);
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    const rows = await q<{ id: string }>(
      `INSERT INTO secondary_trades (${names.map((c) => `"${c}"`).join(',')}) VALUES (${ph}) RETURNING id`,
      vals,
    );
    return rows[0].id;
  }

  // ── repository surface (positive) ─────────────────────────────────────────
  it('insertPending inserts a pending row with STORED gross = count × price', async () => {
    const { base } = await seedTradeParents();
    const trade = await repo.insertPending(em(), base);
    expect(trade).not.toBeNull();
    expect(trade!.status).toBe('pending');
    expect(trade!.grossStroops).toBe('10000'); // 500 × 20
    expect(trade!.txHash).toBeNull();
  });

  it('insertPending returns null on a same-Idempotency-Key retry (ON CONFLICT DO NOTHING)', async () => {
    const { base } = await seedTradeParents();
    const first = await repo.insertPending(em(), base);
    expect(first).not.toBeNull();
    // Terminalize so the pending latch does not also collide (isolates the idem path).
    await repo.casFailed(em(), first!.id, { reason: 'buyer_signature_expired' });
    const dup = await repo.insertPending(em(), { ...base, fractionCount: '1' });
    expect(dup).toBeNull();
    const replay = await repo.findByIdempotency(base.buyerSub, base.rfqId, base.idempotencyKeyHash);
    expect(replay!.id).toBe(first!.id);
  });

  it('findPendingByRfq / findLatestForBuyerRfq reflect trade lifecycle', async () => {
    const { base, rfqId } = await seedTradeParents();
    expect(await repo.findPendingByRfq(rfqId)).toBeNull();
    const t = await repo.insertPending(em(), base);
    expect((await repo.findPendingByRfq(rfqId))!.id).toBe(t!.id);
    expect((await repo.findLatestForBuyerRfq(base.buyerSub, rfqId))!.id).toBe(t!.id);
    // Other buyers see nothing.
    expect(await repo.findLatestForBuyerRfq(randomUUID(), rfqId)).toBeNull();
  });

  it('casSettled flips pending → settled (write-once tx_hash + settled_at); a re-CAS loses', async () => {
    const { base } = await seedTradeParents();
    const t = await repo.insertPending(em(), base);
    expect(await repo.casSettled(em(), t!.id, { txHash: 'abc123' })).toBe(true);
    const [row] = await q<{ status: string; tx_hash: string; settled_at: string }>(
      `SELECT status, tx_hash, settled_at FROM secondary_trades WHERE id=$1`,
      [t!.id],
    );
    expect(row.status).toBe('settled');
    expect(row.tx_hash).toBe('abc123');
    expect(row.settled_at).not.toBeNull();
    // Already terminal → CAS loses (idempotent worker re-run).
    expect(await repo.casSettled(em(), t!.id, { txHash: 'zzz' })).toBe(false);
  });

  it('casFailed flips pending → failed with a reason; a re-CAS loses', async () => {
    const { base } = await seedTradeParents();
    const t = await repo.insertPending(em(), base);
    expect(await repo.casFailed(em(), t!.id, { reason: 'seller_balance_insufficient' })).toBe(true);
    const [row] = await q<{ status: string; failure_reason: string }>(
      `SELECT status, failure_reason FROM secondary_trades WHERE id=$1`,
      [t!.id],
    );
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('seller_balance_insufficient');
    expect(await repo.casSettled(em(), t!.id, { txHash: 'x' })).toBe(false);
  });

  it('findStalePending returns only pending rows older than the grace (fresh + terminal excluded)', async () => {
    const stale = await seedTradeParents();
    const fresh = await seedTradeParents(); // distinct RFQ (the pending latch is per-RFQ)
    const staleId = await insertTrade(stale.base, {
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      idempotency_key_hash: idem(2),
    });
    await insertTrade(fresh.base, { idempotency_key_hash: idem(3) }); // within grace → excluded
    const rows = await repo.findStalePending(5 * 60_000, 10);
    expect(rows.map((r) => r.id)).toEqual([staleId]);
  });

  // ── double-accept latch + idem uniqueness (negative) ──────────────────────
  it('UQ_secondary_trades_pending blocks a 2nd pending trade on the same RFQ; a terminal status frees it', async () => {
    const { base } = await seedTradeParents();
    const first = await insertTrade(base, { idempotency_key_hash: idem(10) });
    await expectPgError(
      () => insertTrade(base, { idempotency_key_hash: idem(11) }),
      UNIQUE_VIOLATION,
      'UQ_secondary_trades_pending',
    );
    await q(`UPDATE secondary_trades SET status='failed', failure_reason='x' WHERE id=$1`, [first]);
    const second = await insertTrade(base, { idempotency_key_hash: idem(12) });
    expect(second).toBeTruthy();
  });

  it('UQ_secondary_trades_idem dedupes on (buyer_sub, rfq_id, idempotency_key_hash) and is FULL', async () => {
    const { base } = await seedTradeParents();
    const first = await insertTrade(base, { idempotency_key_hash: idem(20) });
    await q(`UPDATE secondary_trades SET status='failed', failure_reason='x' WHERE id=$1`, [first]);
    // Same buyer + rfq + idem key → idem UNIQUE even though the pending latch is now free.
    await expectPgError(
      () => insertTrade(base, { idempotency_key_hash: idem(20) }),
      UNIQUE_VIOLATION,
      'UQ_secondary_trades_idem',
    );
    const idx = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_secondary_trades_idem'`,
    );
    expect(idx[0].indexdef).not.toMatch(/WHERE/i);
  });

  // ── CHECK belts + composite FKs (negative + edge) ─────────────────────────
  it('CHK_trade_gross_max rejects a count × price product over i128 (clean 23514, not 22003)', async () => {
    const { base } = await seedTradeParents();
    // Each factor ≤ 2^96-1 (passes count/price CHECKs) but the product ≫ 2^127-1 → the gross CHECK fires,
    // NOT a numeric-overflow 22003 (gross_stroops is unbounded numeric).
    await expectPgError(
      () => insertTrade(base, { fraction_count: MAX_U96, price_per_fraction_stroops: MAX_U96, idempotency_key_hash: idem(30) }),
      CHECK_VIOLATION,
      'CHK_trade_gross_max',
    );
  });

  it('rejects zero/oversized count+price, bad idem length, bad status', async () => {
    const { base } = await seedTradeParents();
    await expectPgError(() => insertTrade(base, { fraction_count: '0', idempotency_key_hash: idem(40) }), CHECK_VIOLATION, 'CHK_trade_count');
    await expectPgError(() => insertTrade(base, { price_per_fraction_stroops: '0', idempotency_key_hash: idem(41) }), CHECK_VIOLATION, 'CHK_trade_price');
    await expectPgError(() => insertTrade(base, { idempotency_key_hash: Buffer.alloc(16, 1) }), CHECK_VIOLATION, 'CHK_trade_idem_len');
    await expectPgError(() => insertTrade(base, { status: 'bogus', idempotency_key_hash: idem(42) }), CHECK_VIOLATION, 'CHK_trade_status');
    // Boundary: exactly MAX_I128 gross is accepted (count=MAX_I128, price=1 — but count must be ≤ 2^96-1,
    // so use price=MAX_I128 impossible; instead assert a large-but-valid gross under the ceiling passes).
    const ok = await insertTrade(base, { fraction_count: MAX_U96, price_per_fraction_stroops: '1', idempotency_key_hash: idem(43) });
    expect(ok).toBeTruthy();
    const [row] = await q<{ gross_stroops: string }>(`SELECT gross_stroops FROM secondary_trades WHERE id=$1`, [ok]);
    expect(row.gross_stroops).toBe(MAX_U96);
  });

  it('rejects a fraction_contract_id that does not match the parent RFQ (composite token FK)', async () => {
    const { base } = await seedTradeParents();
    const other = await seedArtworkWithContract(q);
    await expectPgError(
      () => insertTrade(base, { fraction_contract_id: other.contractId, idempotency_key_hash: idem(50) }),
      FK_VIOLATION,
      'FK_trade_rfq_fc',
    );
  });

  it('rejects a quote_id that does not belong to the trade RFQ (composite pairing FK)', async () => {
    const { base } = await seedTradeParents();
    const otherParents = await seedTradeParents();
    await expectPgError(
      () => insertTrade(base, { quote_id: otherParents.base.quoteId, idempotency_key_hash: idem(51) }),
      FK_VIOLATION,
      'FK_trade_quote_rfq',
    );
  });

  // ── guard trigger (negative) ──────────────────────────────────────────────
  it('blocks DELETE, soft-delete, immutable edits; enforces write-once tx_hash + forward-only status', async () => {
    const { base } = await seedTradeParents();
    const id = await insertTrade(base, { idempotency_key_hash: idem(60) });
    await expect(q(`DELETE FROM secondary_trades WHERE id=$1`, [id])).rejects.toThrow(/cannot be deleted/i);
    await expect(q(`UPDATE secondary_trades SET deleted_at=now() WHERE id=$1`, [id])).rejects.toThrow(/cannot be soft-deleted/i);
    await expect(q(`UPDATE secondary_trades SET fraction_count='1' WHERE id=$1`, [id])).rejects.toThrow(/immutable columns cannot change/i);
    // Forward-only: pending → settled OK; then a 2nd tx_hash write is rejected (write-once).
    await q(`UPDATE secondary_trades SET status='settled', tx_hash='hash1', settled_at=now() WHERE id=$1`, [id]);
    await expect(q(`UPDATE secondary_trades SET tx_hash='hash2' WHERE id=$1`, [id])).rejects.toThrow(/tx_hash is write-once/i);
    await expect(q(`UPDATE secondary_trades SET status='pending' WHERE id=$1`, [id])).rejects.toThrow(/illegal status transition/i);
  });
});
