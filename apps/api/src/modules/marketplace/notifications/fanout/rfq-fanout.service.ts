import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import {
  RFQ_REPOSITORY,
  IRfqRepository,
} from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '@modules/offerings/repositories/offering-bid-repository.interface';
import {
  RFQ_NOTIFICATION_REPOSITORY,
  IRfqNotificationRepository,
} from '../repositories/rfq-notification-repository.interface';
import { NewRfqNotification, TerminalFanoutError } from '../constants/rfq-notification.constants';

/**
 * Resolves an RFQ's holder recipients and writes their in-app notification rows (TOV-174, FR-06.02).
 * Framework-agnostic (no BullMQ import) so it unit-tests with mocked repos; the processor adapts errors.
 *
 * The completion latch (`rfqs.fanned_out_at`), NOT row-existence, is the source of truth for "fanned out"
 * — so the 0-recipient case still latches and is never re-swept. Recipient resolution runs BEFORE the txn
 * (keeps the join off the lock-hold path). Insert + CAS latch + audit are one transaction; the audit row is
 * gated on the CAS win so two racing workers never double-audit.
 */
@Injectable()
export class RfqFanoutService {
  private readonly logger = new Logger(RfqFanoutService.name);

  constructor(
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(RFQ_NOTIFICATION_REPOSITORY) private readonly notifications: IRfqNotificationRepository,
    private readonly audit: AuditLogService,
  ) {}

  async fanout(rfqId: string): Promise<void> {
    const rfq = await this.rfqs.findOneById(rfqId);
    if (!rfq) {
      // Missing / soft-deleted RFQ — retrying can never succeed. Terminal (processor → UnrecoverableError).
      throw new TerminalFanoutError(`rfq ${rfqId} not found`);
    }
    if (rfq.fannedOutAt) return; // already latched — idempotent no-op re-run

    const winnerSubs = await this.bids.findSettledWinnerSubsForArtwork(rfq.artworkId, rfq.collectorSub);
    const rows: NewRfqNotification[] = winnerSubs.map((recipientSub) => ({
      rfqId,
      recipientSub,
      artworkId: rfq.artworkId,
    }));

    await this.rfqs.runInTransaction(async (manager) => {
      await this.notifications.insertManyIgnoreConflicts(manager, rows);
      const won = await this.rfqs.latchFannedOut(manager, rfqId);
      if (!won) return; // a concurrent worker latched first — its audit row is the canonical one
      // Exact recipient count = the rows that actually exist for this RFQ (not the pre-txn winnerSubs.length,
      // which could under-count if a concurrent worker inserted a divergent set — todo 369).
      const recipientCount = await this.notifications.countForRfq(manager, rfqId);
      await this.audit.record(
        {
          actorType: 'system',
          actorId: null,
          kind: AUDIT_KIND.RFQ_NOTIFICATIONS_FANNED_OUT,
          subjectType: 'rfq',
          subjectId: rfqId,
          payload: { recipientCount },
        },
        manager,
      );
    });

    this.logger.log(`rfq fan-out complete [rfq=${rfqId} recipients=${winnerSubs.length}]`);
  }
}
