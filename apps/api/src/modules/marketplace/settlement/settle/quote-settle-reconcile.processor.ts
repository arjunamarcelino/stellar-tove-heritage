import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
} from '../repositories/secondary-trade-repository.interface';
import {
  MARKETPLACE_SETTLER_READ_SERVICE,
  IMarketplaceSettlerReadService,
} from '../marketplace-settler-read.service.interface';
import { QUOTE_SETTLE_RECONCILE_QUEUE } from './quote-settle.job';
import { SettlePersistenceService } from './settle-persistence.service';

/**
 * Stale-`pending` reconcile sweep (TOV-177 #382) — the lost-enqueue / retry-exhausted backstop. The `pending`
 * secondary_trades row IS the per-RFQ double-accept latch (`UQ_secondary_trades_pending`), so a trade stranded
 * `pending` (a crash between commit and the best-effort `settleQueue.add`, an enqueue that threw, or a job that
 * exhausted its 8 attempts) would wedge the RFQ un-fillable forever. This sweep resolves it two ways:
 *
 *  - **adopt** — `is_settled==true` ⇒ the accept_quote already landed on-chain; run the idempotent
 *    `persistSettled` so the DB catches up (trade→settled, rfq→filled, quote→accepted). Safe at any age.
 *  - **abandon** — past the main job's BullMQ retry horizon (so NO live job can still land) AND not on-chain ⇒
 *    the short-lived signed authorizations are gone; fail the trade `settle_abandoned` (keepOpen) to free the
 *    latch so the buyer can re-accept with a fresh signature.
 *
 * It CANNOT re-enqueue a fresh settle: the buyer's passkey assertion + auth entries are job-only bearer material
 * (never persisted, by design), so once the job is gone they cannot be replayed. DB-only reads + is_settled
 * simulate; a single failing row logs and continues. `concurrency:1`.
 */
@Processor(QUOTE_SETTLE_RECONCILE_QUEUE, { concurrency: 1 })
export class QuoteSettleReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(QuoteSettleReconcileProcessor.name);

  // The main settle job is attempts:8 with exponential backoff (5s base) ≈ 5+10+20+40+80+160+320s ≈ 635s. Past
  // this a stale `pending` trade has no live job, so abandoning it cannot race a still-landing tx.
  private static readonly SETTLE_RETRY_HORIZON_MS = 700_000;

  constructor(
    @Inject(SECONDARY_TRADE_REPOSITORY) private readonly trades: ISecondaryTradeRepository,
    @Inject(MARKETPLACE_SETTLER_READ_SERVICE) private readonly settlerRead: IMarketplaceSettlerReadService,
    private readonly persistence: SettlePersistenceService,
    @Inject(marketplaceSettlementConfig.KEY) private readonly cfg: ConfigType<typeof marketplaceSettlementConfig>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const stale = await this.trades.findStalePending(this.cfg.reconcileGraceMs, this.cfg.reconcileBatch);
    const abandonAfterMs = Math.max(this.cfg.reconcileGraceMs, QuoteSettleReconcileProcessor.SETTLE_RETRY_HORIZON_MS);
    let adopted = 0;
    let abandoned = 0;
    for (const trade of stale) {
      try {
        // is_settled throws on unavailable → skip this row this pass (retry next tick), never a spurious terminal.
        if (await this.settlerRead.isSettled(trade.rfqId, trade.quoteId)) {
          await this.persistence.persistSettled(trade, null); // adopt — the tx landed
          adopted += 1;
          continue;
        }
        if (Date.now() - trade.createdAt.getTime() >= abandonAfterMs) {
          await this.persistence.failTrade(trade, { terminal: true, reason: 'settle_abandoned', quoteDisposition: 'keepOpen' });
          abandoned += 1;
        }
        // else: still within the retry horizon — a live BullMQ job may yet land it; leave it for a later tick.
      } catch (err) {
        this.logger.warn(`quote settle reconcile skipped trade ${trade.id}: ${String(err)}`);
      }
    }
    if (adopted > 0 || abandoned > 0) {
      this.logger.warn(`quote settle reconcile: adopted ${adopted}, abandoned ${abandoned} of ${stale.length} stale`);
    }
  }
}
