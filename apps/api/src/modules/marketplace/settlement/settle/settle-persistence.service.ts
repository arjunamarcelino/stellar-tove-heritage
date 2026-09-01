import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { TimelineEmitService } from '@modules/timeline/timeline-emit.service';
import { RFQ_REPOSITORY, IRfqRepository } from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import type { SecondaryTrade } from '../entities/secondary-trade.entity';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
} from '../repositories/secondary-trade-repository.interface';
import type { SettleClassification } from './settle-failure.classifier';

/**
 * The two terminal DB writes of a settle (TOV-177), shared by the main settle processor AND the reconcile
 * processor (#382) so the atomic transitions live in ONE place. Neither method throws for a business outcome
 * (the CAS methods return `affected 0` on a lost race); a transient infra error rolls the whole txn back for
 * the caller's retry/reconcile floor to re-drive.
 */
@Injectable()
export class SettlePersistenceService {
  constructor(
    @Inject(SECONDARY_TRADE_REPOSITORY) private readonly trades: ISecondaryTradeRepository,
    @Inject(QUOTE_REPOSITORY) private readonly quotes: IQuoteRepository,
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    private readonly audit: AuditLogService,
    private readonly timeline: TimelineEmitService,
  ) {}

  /**
   * Success/adopt: flip trade→settled, rfq→filled, winning quote→accepted, rivals→superseded in ONE txn.
   * The block is DELIBERATELY atomic: a partial commit that flipped the trade but left the rfq `open` would let
   * a second accept slip past the `ACCEPT_RFQ_NOT_OPEN` gate and double-settle the same RFQ (#384). A transient
   * throw therefore rolls the WHOLE thing back to `pending`; the retry path / reconcile floor (#382) re-drives
   * it (adopt-if-settled) so a confirmed on-chain settlement never permanently strands as DB-pending.
   */
  async persistSettled(trade: SecondaryTrade, txHash: string | null): Promise<void> {
    await this.trades.runInTransaction(async (manager: EntityManager) => {
      const won = await this.trades.casSettled(manager, trade.id, { txHash });
      if (!won) return; // idempotent re-run — never double-write
      await this.rfqs.casFilled(manager, trade.rfqId);
      const accepted = await this.quotes.casAccepted(manager, trade.quoteId);
      const superseded = await this.quotes.supersedeOpenRivals(manager, trade.rfqId, trade.quoteId);
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.TRADE_SETTLED,
          subjectType: 'secondary_trade',
          subjectId: trade.id,
          payload: { rfqId: trade.rfqId, quoteId: trade.quoteId, txHash },
        },
        manager,
      );
      // Quote-level audit trail for the money-adjacent transitions (#390), atomic with the flip above.
      if (accepted) {
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.QUOTE_ACCEPTED,
            subjectType: 'rfq_quote',
            subjectId: trade.quoteId,
            payload: { rfqId: trade.rfqId, tradeId: trade.id },
          },
          manager,
        );
      }
      if (superseded > 0) {
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.QUOTE_SUPERSEDED,
            subjectType: 'rfq_quote',
            subjectId: trade.quoteId, // the winning quote whose acceptance superseded the rivals
            payload: { rfqId: trade.rfqId, supersededCount: superseded },
          },
          manager,
        );
      }
    });
    // Best-effort, POST-commit provenance event (TOV-191). Outside the txn so a timeline write can never roll
    // back a confirmed settlement; idempotent via source_ref (safe on retry / reconcile re-drive).
    await this.timeline.emitSecondaryTradeSettled({
      tradeId: trade.id,
      fractionContractId: trade.fractionContractId,
      fractionCount: trade.fractionCount,
      pricePerFractionStroops: trade.pricePerFractionStroops,
    });
  }

  /** Terminal failure: flip trade→failed(reason); a seller-fault disposition also expires the quote. */
  async failTrade(
    trade: SecondaryTrade,
    cls: Extract<SettleClassification, { terminal: true }>,
  ): Promise<void> {
    await this.trades.runInTransaction(async (manager: EntityManager) => {
      const won = await this.trades.casFailed(manager, trade.id, { reason: cls.reason });
      if (!won) return;
      let quoteExpired = false;
      if (cls.quoteDisposition === 'expire') {
        quoteExpired = await this.quotes.expireWithReason(manager, trade.quoteId, cls.reason);
      }
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.TRADE_FAILED,
          subjectType: 'secondary_trade',
          subjectId: trade.id,
          payload: { rfqId: trade.rfqId, quoteId: trade.quoteId, reason: cls.reason, quoteDisposition: cls.quoteDisposition },
        },
        manager,
      );
      // Quote-level audit trail for a seller-fault expiry (#390), atomic with the flip.
      if (quoteExpired) {
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.QUOTE_EXPIRED,
            subjectType: 'rfq_quote',
            subjectId: trade.quoteId,
            payload: { rfqId: trade.rfqId, tradeId: trade.id, reason: cls.reason },
          },
          manager,
        );
      }
    });
  }
}
