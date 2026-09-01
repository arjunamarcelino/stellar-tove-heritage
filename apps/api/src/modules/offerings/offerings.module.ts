import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offering } from './entities/offering.entity';
import { OfferingApproval } from './entities/offering-approval.entity';
import { OfferingBid } from './entities/offering-bid.entity';
import { OfferingClearingAudit } from './entities/offering-clearing-audit.entity';
import { OFFERING_REPOSITORY } from './repositories/offering-repository.interface';
import { OfferingRepository } from './repositories/offering.repository';
import { OFFERING_APPROVAL_REPOSITORY } from './repositories/offering-approval-repository.interface';
import { OfferingApprovalRepository } from './repositories/offering-approval.repository';
import { OFFERING_BID_REPOSITORY } from './repositories/offering-bid-repository.interface';
import { OfferingBidRepository } from './repositories/offering-bid.repository';
import { OFFERING_CLEARING_AUDIT_REPOSITORY } from './repositories/offering-clearing-audit-repository.interface';
import { OfferingClearingAuditRepository } from './repositories/offering-clearing-audit.repository';

/**
 * Neutral offerings domain (TOV-152 planning, TOV-154 approval, TOV-156 bids): the `offerings` +
 * `offering_approvals` + `offering_bids` entities/repos and their ports. Provider-only, config-free —
 * deliberately does NOT provide the config/network-dependent on-chain services (escrow deploy / relayer
 * bid submit live in their worker/surface modules, their only consumers) so this module stays importable
 * by the fixed-config integration harness. Binds and exports `OFFERING_REPOSITORY` +
 * `OFFERING_APPROVAL_REPOSITORY` + `OFFERING_BID_REPOSITORY` + `TypeOrmModule`. The bid HTTP surface
 * (`bids/`) and the bid escrow worker each import THIS module for `OFFERING_BID_REPOSITORY` +
 * `OFFERING_REPOSITORY` (bids validate against the parent offering).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Offering, OfferingApproval, OfferingBid, OfferingClearingAudit]),
  ],
  providers: [
    { provide: OFFERING_REPOSITORY, useClass: OfferingRepository },
    { provide: OFFERING_APPROVAL_REPOSITORY, useClass: OfferingApprovalRepository },
    { provide: OFFERING_BID_REPOSITORY, useClass: OfferingBidRepository },
    { provide: OFFERING_CLEARING_AUDIT_REPOSITORY, useClass: OfferingClearingAuditRepository },
  ],
  exports: [
    OFFERING_REPOSITORY,
    OFFERING_APPROVAL_REPOSITORY,
    OFFERING_BID_REPOSITORY,
    OFFERING_CLEARING_AUDIT_REPOSITORY,
    TypeOrmModule,
  ],
})
export class OfferingsModule {}
