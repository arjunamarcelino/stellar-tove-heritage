import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { SettlementModule } from '@modules/marketplace/settlement/settlement.module';
import { QuotesModule } from '@modules/marketplace/quotes/quotes.module';
import { RfqsModule } from '@modules/marketplace/rfqs/rfqs.module';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
} from '@modules/marketplace/settlement/repositories/secondary-trade-repository.interface';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import { RFQ_REPOSITORY, IRfqRepository } from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import { SettlePersistenceService } from '@modules/marketplace/settlement/settle/settle-persistence.service';
import { TimelineEmitService } from '@modules/timeline/timeline-emit.service';
import { QuoteSettleReconcileProcessor } from '@modules/marketplace/settlement/settle/quote-settle-reconcile.processor';
import type { MarketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { FakeMarketplaceSettlerRead } from '../../../shared/fake-marketplace-settler-read';
import { seedArtworkWithContract, seedOpenRfq, seedQuote } from '../../../shared/seed-marketplace';

/**
 * TOV-177 #382 — the lost-enqueue / retry-exhausted reconcile backstop. Drives the reconcile processor against
 * real repos + the shared atomic `SettlePersistenceService`, with a fake `is_settled` oracle: a stale pending
 * trade is either ADOPTED (already settled on-chain) or, past the BullMQ retry horizon, ABANDONED (keepOpen) so
 * the RFQ latch is freed. A young-but-stale trade within the horizon is left for a live job.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */
describe('quote settle reconcile backstop (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let trades: ISecondaryTradeRepository;
  let proc: QuoteSettleReconcileProcessor;
  const settlerRead = new FakeMarketplaceSettlerRead();
  // graceMs tiny so any age is "stale"; the abandon decision is gated by the ~700s retry horizon inside the proc.
  const cfg = { reconcileGraceMs: 1000, reconcileBatch: 100 } as MarketplaceSettlementConfig;

  const q = (text: string, params: unknown[] = []): Promise<unknown[]> => ds.query(text, params);
  const HORIZON_PAST = () => new Date(Date.now() - 20 * 60_000).toISOString(); // 20 min ago > 700s horizon
  const RECENT = () => new Date(Date.now() - 2 * 60_000).toISOString(); // 2 min ago < 700s horizon

  /** Raw-insert a pending trade with an explicit created_at (the repo would stamp now()). Returns the id. */
  async function insertPendingAt(rfqId: string, quoteId: string, contractId: string, createdAt: string, idemSeed: number): Promise<string> {
    const rows = (await q(
      `INSERT INTO secondary_trades
         (rfq_id, quote_id, buyer_sub, seller_sub, fraction_contract_id, fraction_count,
          price_per_fraction_stroops, status, idempotency_key_hash, created_at)
       VALUES ($1,$2,gen_random_uuid(),gen_random_uuid(),$3,'5','20','pending',$4,$5) RETURNING id`,
      [rfqId, quoteId, contractId, Buffer.alloc(32, idemSeed), createdAt],
    )) as { id: string }[];
    return rows[0].id;
  }

  beforeAll(async () => {
    moduleRef = await createTestingModule(SettlementModule, QuotesModule, RfqsModule, WalletsAuditModule);
    ds = moduleRef.get(DataSource);
    trades = moduleRef.get<ISecondaryTradeRepository>(SECONDARY_TRADE_REPOSITORY);
    const quotes = moduleRef.get<IQuoteRepository>(QUOTE_REPOSITORY);
    const rfqs = moduleRef.get<IRfqRepository>(RFQ_REPOSITORY);
    const audit = moduleRef.get(AuditLogService);
    const timeline = new TimelineEmitService(ds);
    const persistence = new SettlePersistenceService(trades, quotes, rfqs, audit, timeline);
    proc = new QuoteSettleReconcileProcessor(trades, settlerRead, persistence, cfg);
  });
  afterAll(async () => {
    await moduleRef?.close();
  });
  beforeEach(async () => {
    await truncateTables(ds);
    settlerRead.reset();
  });

  it('ADOPTS a stale pending trade whose tx already landed (is_settled) → settled + rfq filled + rivals superseded', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId, { authorized: true });
    const rival = await seedQuote(q, rfqId, contractId, { holderSub: randomUUID() });
    const tradeId = await insertPendingAt(rfqId, quoteId, contractId, HORIZON_PAST(), 1);
    settlerRead.markSettled(rfqId, quoteId);

    await proc.process();

    const [t] = (await q(`SELECT status, settled_at FROM secondary_trades WHERE id=$1`, [tradeId])) as { status: string; settled_at: string }[];
    const [rfq] = (await q(`SELECT status FROM rfqs WHERE id=$1`, [rfqId])) as { status: string }[];
    const [won] = (await q(`SELECT status FROM rfq_quotes WHERE id=$1`, [quoteId])) as { status: string }[];
    const [lost] = (await q(`SELECT status FROM rfq_quotes WHERE id=$1`, [rival])) as { status: string }[];
    expect(t.status).toBe('settled');
    expect(t.settled_at).not.toBeNull();
    expect(rfq.status).toBe('filled');
    expect(won.status).toBe('accepted');
    expect(lost.status).toBe('superseded');
  });

  it('ABANDONS a stale pending trade past the retry horizon that never settled → failed(settle_abandoned), rfq + quote stay open', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId, { authorized: true });
    const tradeId = await insertPendingAt(rfqId, quoteId, contractId, HORIZON_PAST(), 2);
    // is_settled stays false.

    await proc.process();

    const [t] = (await q(`SELECT status, failure_reason FROM secondary_trades WHERE id=$1`, [tradeId])) as { status: string; failure_reason: string }[];
    const [rfq] = (await q(`SELECT status FROM rfqs WHERE id=$1`, [rfqId])) as { status: string }[];
    const [quote] = (await q(`SELECT status FROM rfq_quotes WHERE id=$1`, [quoteId])) as { status: string }[];
    expect(t.status).toBe('failed');
    expect(t.failure_reason).toBe('settle_abandoned');
    expect(rfq.status).toBe('open'); // buyer can re-accept
    expect(quote.status).toBe('open');
  });

  it('LEAVES a young-but-stale pending trade within the retry horizon (a live job may still land it)', async () => {
    const { artworkId, contractId } = await seedArtworkWithContract(q);
    const rfqId = await seedOpenRfq(q, artworkId, contractId);
    const quoteId = await seedQuote(q, rfqId, contractId, { authorized: true });
    const tradeId = await insertPendingAt(rfqId, quoteId, contractId, RECENT(), 3);

    await proc.process();

    const [t] = (await q(`SELECT status FROM secondary_trades WHERE id=$1`, [tradeId])) as { status: string }[];
    expect(t.status).toBe('pending'); // not abandoned — still within the BullMQ retry horizon
  });
});
